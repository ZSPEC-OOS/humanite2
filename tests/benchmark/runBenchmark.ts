import type OpenAI from 'openai'
import { preprocess } from '@/lib/preprocess'
import { chunkFactLockedText } from '@/lib/chunk'
import { humanizeChunk, aggregateChunkResults, joinChunkResults, type ChunkResult } from '@/lib/humanizePipeline'
import { GPTZeroProvider } from '@/lib/detection/providers/gptzero'
import { SaplingProvider } from '@/lib/detection/providers/sapling'
import type { DetectionProvider } from '@/lib/detection/providers/provider'
import { CORPUS } from './corpus'
import { hasSufficientReferenceData, referencePassagesByDomain } from './reference'
import type { CorpusItem, BenchmarkItemResult, BenchmarkReport, DetectorSample } from './types'

// Mirrors the production route (src/app/api/v1/humanize/route.ts) exactly —
// the benchmark measures the real pipeline's real chunking/retry behavior,
// not a simplified stand-in.
const CHUNK_MAX_CHARS = 24_000
const MAX_GATE_RETRIES = 2
const DEFAULT_INTENSITY = 5
const DEFAULT_TONE = 'balanced'

// Approximate, for this benchmark's own cost tracking only — not wired to
// actual billing. $ per 1,000 tokens, blended input/output. Update the
// table (or pass a custom one via RunBenchmarkOptions) if pricing or the
// default model changes.
const DEFAULT_MODEL_PRICING_PER_1K_TOKENS: Record<string, number> = {
  'gpt-4o-mini': 0.00015,
  'text-embedding-3-small': 0.00002,
}
const FALLBACK_PRICE_PER_1K_TOKENS = 0.0005

function estimateCostUsd(model: string, totalTokens: number, pricing: Record<string, number>): number {
  const rate = pricing[model] ?? FALLBACK_PRICE_PER_1K_TOKENS
  return (totalTokens / 1000) * rate
}

export interface UsageTally {
  totalTokens: number
  callCount: number
}

// Wraps a real OpenAI client to tally token usage across however many
// completion/embedding calls a single humanizeChunk invocation makes
// internally (generation, retries, and the judge call) — instrumentation
// lives entirely here, in the benchmark harness, rather than inside
// humanizePipeline.ts, so Phase 1's pipeline contract stays untouched by
// Phase 2's measurement needs. Built as a plain object satisfying the
// surface humanizeChunk/runQualityGates actually call, the same pattern
// the existing unit tests use for a mock client (see qualityGates.test.ts).
export function instrumentClient(client: OpenAI): { client: OpenAI; usage: UsageTally } {
  const usage: UsageTally = { totalTokens: 0, callCount: 0 }
  const wrapped = {
    chat: {
      completions: {
        create: async (...args: Parameters<OpenAI['chat']['completions']['create']>) => {
          const result = await client.chat.completions.create(...args)
          usage.callCount++
          usage.totalTokens += (result as { usage?: { total_tokens?: number } }).usage?.total_tokens ?? 0
          return result
        },
      },
    },
    embeddings: {
      create: async (...args: Parameters<OpenAI['embeddings']['create']>) => {
        const result = await client.embeddings.create(...args)
        usage.callCount++
        usage.totalTokens += (result as { usage?: { total_tokens?: number } }).usage?.total_tokens ?? 0
        return result
      },
    },
  } as unknown as OpenAI
  return { client: wrapped, usage }
}

export interface RunBenchmarkOptions {
  client: OpenAI
  model: string
  // Defaults to the full 60-item CORPUS — pass a slice for a smoke test.
  items?: CorpusItem[]
  // Defaults to [GPTZeroProvider(), SaplingProvider()] (each reads its own
  // API key from env) — satisfies "at least two detectors" without the
  // caller needing to know which two.
  detectorProviders?: DetectionProvider[]
  modelPricingPer1kTokens?: Record<string, number>
  // Target false-positive rate for detector calibration (see
  // calibrateDetector below). Defaults to 5%.
  targetFalsePositiveRate?: number
}

async function runOneItem(
  item: CorpusItem,
  rawClient: OpenAI,
  model: string,
  detectors: DetectionProvider[],
): Promise<BenchmarkItemResult> {
  const started = performance.now()
  try {
    const { client, usage } = instrumentClient(rawClient)
    const prep = preprocess(item.input)
    const chunks = chunkFactLockedText(prep.sanitized_text, prep.fact_locks, CHUNK_MAX_CHARS)

    const chunkResults: ChunkResult[] = []
    for (const chunk of chunks) {
      chunkResults.push(await humanizeChunk(
        client, model, chunk.text, chunk.text, chunk.factLocks,
        DEFAULT_INTENSITY, DEFAULT_TONE, item.domain, MAX_GATE_RETRIES,
      ))
    }
    const outputText = joinChunkResults(chunkResults, chunks)
    const agg = aggregateChunkResults(chunkResults)

    const prohibitedChangesFound = item.prohibitedChanges.filter(p => outputText.includes(p))

    const detectorSamples: DetectorSample[] = []
    for (const detector of detectors) {
      try {
        const detection = await detector.detect(outputText)
        detectorSamples.push({
          provider: detector.id,
          classification: detection.classification,
          ai_probability: detection.probabilities.ai,
          // Filled in at the report level (calibrateDetector) — a single
          // sample can't know the fixed-FPR threshold on its own.
          calibrated_ai_rate: null,
        })
      } catch (err) {
        detectorSamples.push({
          provider: detector.id,
          classification: 'error',
          ai_probability: null,
          calibrated_ai_rate: null,
        })
      }
    }

    return {
      id: item.id,
      domain: item.domain,
      latencyMs: Math.round(performance.now() - started),
      totalTokens: usage.totalTokens,
      estimatedCostUsd: estimateCostUsd(model, usage.totalTokens, DEFAULT_MODEL_PRICING_PER_1K_TOKENS),
      retryCount: agg.retry_count,
      entityPreservation: agg.entity_preservation,
      semanticSimilarity: agg.semantic_similarity,
      fidelityPassed: agg.passed,
      missingFacts: agg.missing_facts,
      prohibitedChangesFound,
      detectors: detectorSamples,
    }
  } catch (err) {
    return {
      id: item.id,
      domain: item.domain,
      latencyMs: Math.round(performance.now() - started),
      totalTokens: 0,
      estimatedCostUsd: 0,
      retryCount: 0,
      entityPreservation: null,
      semanticSimilarity: null,
      fidelityPassed: null,
      missingFacts: [],
      prohibitedChangesFound: [],
      detectors: [],
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

// Calibrates a detector's ai_probability threshold against the human
// reference set so that TARGET_FALSE_POSITIVE_RATE of known-human passages
// would be misclassified as AI, then the caller reports what fraction of
// this run's humanized outputs clear that same threshold. Returns null —
// never a fabricated number — unless every domain actually run has at
// least MIN_REFERENCE_PASSAGES_PER_DOMAIN real human-written passages (see
// reference/index.ts, currently unpopulated).
async function calibrateDetector(
  detector: DetectionProvider,
  domains: CorpusItem['domain'][],
  targetFpr: number,
): Promise<number | null> {
  const uniqueDomains = [...new Set(domains)]
  if (uniqueDomains.some(d => !hasSufficientReferenceData(d))) return null

  const humanAiScores: number[] = []
  for (const domain of uniqueDomains) {
    for (const passage of referencePassagesByDomain(domain)) {
      try {
        const result = await detector.detect(passage.text)
        if (result.probabilities.ai != null) humanAiScores.push(result.probabilities.ai)
      } catch {
        // A single failed calibration call shouldn't abort calibration —
        // it just contributes one fewer data point.
      }
    }
  }
  if (humanAiScores.length === 0) return null

  humanAiScores.sort((a, b) => a - b)
  const idx = Math.min(humanAiScores.length - 1, Math.floor((1 - targetFpr) * humanAiScores.length))
  return humanAiScores[idx]!
}

export async function runBenchmark(options: RunBenchmarkOptions): Promise<BenchmarkReport> {
  const items = options.items ?? CORPUS
  const detectors = options.detectorProviders ?? [new GPTZeroProvider(), new SaplingProvider()]
  const targetFpr = options.targetFalsePositiveRate ?? 0.05

  const results: BenchmarkItemResult[] = []
  for (const item of items) {
    results.push(await runOneItem(item, options.client, options.model, detectors))
  }

  const domains = items.map(i => i.domain)
  const detectorAiRateAtFixedFpr: Record<string, number | null> = {}
  for (const detector of detectors) {
    const threshold = await calibrateDetector(detector, domains, targetFpr)
    if (threshold == null) {
      detectorAiRateAtFixedFpr[detector.id] = null
      continue
    }
    const samples = results.flatMap(r => r.detectors.filter(d => d.provider === detector.id))
    const scored = samples.filter(s => s.ai_probability != null)
    detectorAiRateAtFixedFpr[detector.id] = scored.length
      ? scored.filter(s => s.ai_probability! >= threshold).length / scored.length
      : null
  }

  return buildReport(options.model, results, detectorAiRateAtFixedFpr)
}

function buildReport(
  model: string,
  results: BenchmarkItemResult[],
  detectorAiRateAtFixedFpr: Record<string, number | null>,
): BenchmarkReport {
  const scored = results.filter(r => !r.error)
  const average = (select: (r: BenchmarkItemResult) => number | null): number | null => {
    const values = scored.map(select).filter((v): v is number => v != null)
    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null
  }
  const withPassedKnown = scored.filter(r => r.fidelityPassed != null)

  return {
    generatedAt: new Date().toISOString(),
    model,
    itemCount: results.length,
    results,
    summary: {
      meanEntityPreservation: average(r => r.entityPreservation),
      meanSemanticSimilarity: average(r => r.semanticSimilarity),
      fidelityPassRate: withPassedKnown.length
        ? withPassedKnown.filter(r => r.fidelityPassed).length / withPassedKnown.length
        : null,
      retryRate: scored.length ? scored.filter(r => r.retryCount > 0).length / scored.length : 0,
      meanLatencyMs: average(r => r.latencyMs) ?? 0,
      totalTokens: results.reduce((sum, r) => sum + r.totalTokens, 0),
      totalEstimatedCostUsd: results.reduce((sum, r) => sum + r.estimatedCostUsd, 0),
      detectorAiRateAtFixedFpr,
      prohibitedChangeViolations: results.reduce((sum, r) => sum + r.prohibitedChangesFound.length, 0),
    },
  }
}

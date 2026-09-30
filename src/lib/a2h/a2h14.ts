import type { Firestore } from 'firebase-admin/firestore'
import type OpenAI from 'openai'
import { createHash } from 'crypto'
import { preprocess } from '@/lib/preprocess'
import { humanizeChunk } from '@/lib/humanizePipeline'
import { calculateLocalDiagnostics } from '@/lib/detection/diagnostics'
import { toValidGenre, toValidAudience } from '@/lib/style/types'
import type { BenchmarkRun, BenchmarkJob, CorpusSource, BenchmarkTrial, GenreAudienceContrast } from './types'
import { getOrCreateTrial, listTrialsForRun, type TrialRunResult } from './trials'
import { groupBy } from './statistics'
import { aggregateMetric, type StyleToneMetricAggregate, type StyleToneMetricDelta, metricDelta } from './styleContrastShared'

export const A2H14_CODE = 'A2H-14' as const
const MAX_GATE_RETRIES = 2
const FIXED_TONE = 'balanced'
const FIXED_INTENSITY = 5

function leftConditionId(contrastId: string): string { return `${contrastId}__left` }
function rightConditionId(contrastId: string): string { return `${contrastId}__right` }

// Real, currently-supported Genre/Audience values only (style/types.ts's
// GENRES/AUDIENCES). The first contrast reproduces
// tests/benchmark/tests/documentAcceptance.test.ts's own comparison
// (medical + patient_instructions vs medical + research_paper) as a
// production benchmark measurement rather than only a live acceptance test.
export const INITIAL_GENRE_AUDIENCE_CONTRASTS: GenreAudienceContrast[] = [
  {
    id: 'patient-instructions-vs-research-paper',
    label: 'Patient Instructions → Research Paper',
    domain: 'medical',
    left: { genre: 'patient_instructions' },
    right: { genre: 'research_paper' },
    expectedDirections: {
      readability: 'higher_left',
      averageSentenceLength: 'higher_right',
      lexicalComplexity: 'higher_right',
    },
  },
  {
    id: 'executive-vs-general-audience',
    label: 'Executive Audience → General Audience',
    domain: null,
    left: { audience: 'executive' },
    right: { audience: 'general' },
    expectedDirections: {
      averageSentenceLength: 'higher_right',
      readability: 'higher_left',
      paragraphLength: 'higher_right',
    },
  },
]

export interface GenreAudienceCondition {
  sourceId: string
  contrastId: string
  side: 'left' | 'right'
  conditionId: string
}

export function generateA2H14Conditions(sourceIds: string[], contrasts: GenreAudienceContrast[]): GenreAudienceCondition[] {
  const conditions: GenreAudienceCondition[] = []
  for (const sourceId of sourceIds) {
    for (const contrast of contrasts) {
      conditions.push({ sourceId, contrastId: contrast.id, side: 'left', conditionId: leftConditionId(contrast.id) })
      conditions.push({ sourceId, contrastId: contrast.id, side: 'right', conditionId: rightConditionId(contrast.id) })
    }
  }
  return conditions
}

export interface RunA2H14TrialOptions {
  client: OpenAI
  model: string
  modelProvider: string
}

export async function runA2H14Trial(firestore: Firestore, run: BenchmarkRun, source: CorpusSource, job: BenchmarkJob, options: RunA2H14TrialOptions): Promise<void> {
  if (!job.conditionId) throw new Error(`A2H-14 trial job ${job.id} is missing conditionId.`)
  const contrasts = run.experimentConfig?.genreAudience?.contrasts ?? []
  const isLeft = job.conditionId.endsWith('__left')
  const contrastId = job.conditionId.replace(/__(left|right)$/, '')
  const contrast = contrasts.find(c => c.id === contrastId)
  if (!contrast) throw new Error(`A2H-14 trial job ${job.id} references unknown contrast ${contrastId}.`)
  const side = isLeft ? contrast.left : contrast.right
  const genre = toValidGenre(side.genre ?? null)
  const audience = toValidAudience(side.audience ?? null)
  const domain = contrast.domain ?? source.domainId

  await getOrCreateTrial(firestore, {
    runId: run.id,
    corpusProjectId: run.corpusProjectId,
    benchmarkCode: A2H14_CODE,
    sourceId: source.id,
    conditionId: job.conditionId,
    trialIndex: 0,
    condition: { sourceId: source.id, contrastId, side: isLeft ? 'left' : 'right', genre, audience, domain, intensity: FIXED_INTENSITY },
    run: async (): Promise<TrialRunResult> => {
      const start = Date.now()
      try {
        const prep = preprocess(source.text)
        const result = await humanizeChunk(
          options.client, options.model, source.text, prep.sanitized_text, prep.fact_locks,
          FIXED_INTENSITY, FIXED_TONE, domain, MAX_GATE_RETRIES, genre, audience,
        )
        return {
          outputText: result.text,
          outputSha256: createHash('sha256').update(result.text).digest('hex'),
          outputWords: result.text.trim() ? result.text.trim().split(/\s+/).length : 0,
          modelProvider: options.modelProvider,
          model: result.modelUsed,
          latencyMs: Date.now() - start,
          modelCalls: result.modelCalls,
          retryCount: result.retryCount,
          candidateCount: result.candidateSelection.candidateCount,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          estimatedCostUsd: null,
          aiProbability: null,
          humanProbability: null,
          classification: null,
          diagnostics: null,
          status: 'success',
          errorCode: null,
          errorMessage: null,
        }
      } catch (err) {
        return {
          outputText: null, outputSha256: null, outputWords: null, modelProvider: options.modelProvider, model: options.model,
          latencyMs: Date.now() - start, modelCalls: null, retryCount: 0, candidateCount: null, inputTokens: null, outputTokens: null,
          estimatedCostUsd: null, aiProbability: null, humanProbability: null, classification: null, diagnostics: null,
          status: 'failed', errorCode: err instanceof Error ? err.constructor.name : 'UnknownError',
          errorMessage: err instanceof Error ? err.message : 'Genre/audience trial failed.',
        }
      }
    },
  })
}

// ── Measurement / aggregation (§15-16) ────────────────────────────────────
//
// Deterministic metrics only (§16: "no subjective genre classifier"):
// readability (Flesch), average sentence length, and paragraph length reuse
// calculateLocalDiagnostics directly; "lexical complexity" is mapped onto
// that same module's lexical_diversity (type-token ratio) — the one
// vocabulary-breadth statistic already available — since this deployment has
// no dedicated syllable-per-word or rare-word-ratio complexity metric.

export interface GenreAudiencePairMeasurements {
  sourceId: string
  contrastId: string
  readability: StyleToneMetricDelta
  averageSentenceLength: StyleToneMetricDelta
  lexicalComplexity: StyleToneMetricDelta
  paragraphLength: StyleToneMetricDelta
  firstPersonRate: StyleToneMetricDelta
}

function paragraphLength(wordCount: number, paragraphCount: number): number | null {
  return paragraphCount === 0 ? null : wordCount / paragraphCount
}

export function computeGenreAudiencePairMeasurements(sourceId: string, contrastId: string, leftText: string, rightText: string, contrast: GenreAudienceContrast): GenreAudiencePairMeasurements {
  const left = calculateLocalDiagnostics(leftText)
  const right = calculateLocalDiagnostics(rightText)
  return {
    sourceId,
    contrastId,
    readability: metricDelta(left.readability_score, right.readability_score, contrast.expectedDirections.readability),
    averageSentenceLength: metricDelta(left.average_sentence_length, right.average_sentence_length, contrast.expectedDirections.averageSentenceLength),
    lexicalComplexity: metricDelta(left.lexical_diversity, right.lexical_diversity, contrast.expectedDirections.lexicalComplexity),
    paragraphLength: metricDelta(paragraphLength(left.word_count, left.paragraph_count), paragraphLength(right.word_count, right.paragraph_count), contrast.expectedDirections.paragraphLength),
    firstPersonRate: metricDelta(left.first_person_rate, right.first_person_rate, contrast.expectedDirections.firstPersonRate),
  }
}

export interface GenreAudienceContrastAggregate {
  contrastId: string
  label: string
  n: number
  readability: StyleToneMetricAggregate
  averageSentenceLength: StyleToneMetricAggregate
  lexicalComplexity: StyleToneMetricAggregate
  paragraphLength: StyleToneMetricAggregate
  firstPersonRate: StyleToneMetricAggregate
}

export function aggregateGenreAudienceContrast(pairs: GenreAudiencePairMeasurements[], contrast: GenreAudienceContrast): GenreAudienceContrastAggregate {
  return {
    contrastId: contrast.id,
    label: contrast.label,
    n: pairs.length,
    readability: aggregateMetric(pairs.map(p => p.readability)),
    averageSentenceLength: aggregateMetric(pairs.map(p => p.averageSentenceLength)),
    lexicalComplexity: aggregateMetric(pairs.map(p => p.lexicalComplexity)),
    paragraphLength: aggregateMetric(pairs.map(p => p.paragraphLength)),
    firstPersonRate: aggregateMetric(pairs.map(p => p.firstPersonRate)),
  }
}

export interface A2H14Report {
  contrasts: GenreAudienceContrastAggregate[]
  pairs: GenreAudiencePairMeasurements[]
}

export async function getA2H14Report(firestore: Firestore, runId: string, contrasts: GenreAudienceContrast[]): Promise<A2H14Report> {
  const trials = await listTrialsForRun(firestore, runId, A2H14_CODE)
  const successful = trials.filter((t: BenchmarkTrial) => t.status === 'success' && t.outputText != null)
  const byPair = groupBy(successful, t => `${t.sourceId}__${t.condition['contrastId'] as string}`)

  const pairs: GenreAudiencePairMeasurements[] = []
  for (const [, group] of byPair) {
    const left = group.find(t => t.condition['side'] === 'left')
    const right = group.find(t => t.condition['side'] === 'right')
    if (!left || !right) continue
    const contrastId = left.condition['contrastId'] as string
    const contrast = contrasts.find(c => c.id === contrastId)
    if (!contrast) continue
    pairs.push(computeGenreAudiencePairMeasurements(left.sourceId, contrastId, left.outputText!, right.outputText!, contrast))
  }

  const contrastAggregates = contrasts.map(contrast => aggregateGenreAudienceContrast(pairs.filter(p => p.contrastId === contrast.id), contrast))
  return { contrasts: contrastAggregates, pairs }
}

import type { Firestore } from 'firebase-admin/firestore'
import type OpenAI from 'openai'
import { createHash } from 'crypto'
import { preprocess } from '@/lib/preprocess'
import { humanizeChunk } from '@/lib/humanizePipeline'
import { measureIntensity } from '@/lib/evaluation/intensity'
import { candidateCountForIntensity } from '@/lib/selection'
import type { BenchmarkRun, BenchmarkJob, CorpusSource, BenchmarkTrial, BenchmarkFixture, BenchmarkOutput, A2HTestCode } from './types'
import { getOrCreateTrial, listTrialsForRun, type TrialRunResult } from './trials'
import { scoreTextWithGPTZero } from './baseline'
import { evaluateGrammarDamage, type A2H08Measurements } from './a2h08'
import { DETERMINISTIC_EVALUATORS } from './deterministicEvaluators'
import { FIXTURE_TYPE_FOR_TEST } from './types'
import { listFixturesForSource } from './fixtures'
import { getSourceById } from './corpus'
import { summarizeContinuous, groupBy, type ContinuousSummary } from './statistics'

export const A2H15_CODE = 'A2H-15' as const
const MAX_GATE_RETRIES = 2
const FIXED_TONE = 'balanced'

// A2H-15 — Candidate Selection Effectiveness (§17-22). Compares production
// multi-candidate search/selection (ARM B) against a single-candidate
// baseline (ARM A) under matched source/intensity/tone/domain/model
// conditions — only candidate-selection behavior differs between arms.
// Requires an intensity that actually invokes candidate search
// (candidateCountForIntensity(intensity) > 1, i.e. intensity >= 4) — run
// validation enforces this (§38).

const PRESERVATION_CODES: readonly A2HTestCode[] = ['A2H-04', 'A2H-05', 'A2H-09', 'A2H-10', 'A2H-13']

function conditionId(intensity: number, arm: 'single' | 'production'): string {
  return `i${intensity}__${arm}`
}

function parseConditionId(id: string): { intensity: number; arm: 'single' | 'production' } | null {
  const m = /^i(\d+)__(single|production)$/.exec(id)
  if (!m) return null
  return { intensity: Number(m[1]), arm: m[2] as 'single' | 'production' }
}

export interface CandidateSelectionCondition {
  sourceId: string
  intensity: number
  arm: 'single' | 'production'
  conditionId: string
}

// Only intensities where candidateCountForIntensity actually invokes search
// (>= 4) produce a meaningful arm-B — a lower intensity's "production" arm
// would be identical to "single" by construction, wasting a paid call to
// measure nothing.
export function generateA2H15Conditions(sourceIds: string[], intensities: number[]): CandidateSelectionCondition[] {
  const conditions: CandidateSelectionCondition[] = []
  for (const sourceId of sourceIds) {
    for (const intensity of intensities.filter(i => candidateCountForIntensity(i) > 1)) {
      conditions.push({ sourceId, intensity, arm: 'single', conditionId: conditionId(intensity, 'single') })
      conditions.push({ sourceId, intensity, arm: 'production', conditionId: conditionId(intensity, 'production') })
    }
  }
  return conditions
}

export interface RunA2H15TrialOptions {
  client: OpenAI
  model: string
  modelProvider: string
  gptZeroApiKey: string
}

export async function runA2H15Trial(firestore: Firestore, run: BenchmarkRun, source: CorpusSource, job: BenchmarkJob, options: RunA2H15TrialOptions): Promise<void> {
  if (!job.conditionId) throw new Error(`A2H-15 trial job ${job.id} is missing conditionId.`)
  const parsed = parseConditionId(job.conditionId)
  if (!parsed) throw new Error(`A2H-15 trial job ${job.id} has an unrecognized conditionId ${job.conditionId}.`)
  const { intensity, arm } = parsed
  const candidateCountOverride = arm === 'single' ? 1 : null

  await getOrCreateTrial(firestore, {
    runId: run.id,
    corpusProjectId: run.corpusProjectId,
    benchmarkCode: A2H15_CODE,
    sourceId: source.id,
    conditionId: job.conditionId,
    trialIndex: 0,
    condition: { sourceId: source.id, intensity, arm },
    run: async (): Promise<TrialRunResult> => {
      const start = Date.now()
      try {
        const prep = preprocess(source.text)
        const result = await humanizeChunk(
          options.client, options.model, source.text, prep.sanitized_text, prep.fact_locks,
          intensity, FIXED_TONE, source.domainId, MAX_GATE_RETRIES,
          null, null, null, candidateCountOverride,
        )
        const detector = await scoreTextWithGPTZero(result.text, options.gptZeroApiKey)
        const transformationMagnitude = measureIntensity(source.text, result.text, prep.fact_locks.map(l => l.text)).transformationMagnitude
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
          aiProbability: detector.aiProbability,
          humanProbability: detector.humanProbability,
          classification: detector.classification,
          diagnostics: {
            transformationMagnitude,
            candidateSelection: result.candidateSelection,
            gatesUnavailable: result.gatesUnavailable,
            passed: result.gate?.passed ?? null,
          },
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
          errorMessage: err instanceof Error ? err.message : 'Candidate-selection trial failed.',
        }
      }
    },
  })
}

// ── Measurement / aggregation (§20-22) ────────────────────────────────────

function buildSyntheticOutput(source: CorpusSource, intensity: number, outputText: string): BenchmarkOutput {
  const trimmed = outputText.trim()
  return {
    id: 'synthetic', runId: '', corpusProjectId: source.corpusProjectId, sourceId: source.id, domainId: source.domainId,
    topicId: source.topicId, targetWords: source.targetWords, intensity, outputText,
    outputWords: trimmed ? trimmed.split(/\s+/).length : 0, outputSha256: '', modelProvider: '', model: '',
    latencyMs: 0, modelCalls: null, retryCount: 0, candidateCount: null, inputTokens: null, outputTokens: null,
    estimatedCostUsd: null, generatedAt: new Date().toISOString(), status: 'success', errorCode: null, errorMessage: null,
  }
}

export interface DeltaValue {
  single: number | null
  production: number | null
  delta: number | null
}

function delta(single: number | null, production: number | null): DeltaValue {
  if (single == null || production == null) return { single, production, delta: null }
  return { single, production, delta: production - single }
}

export interface CandidateSelectionPairMeasurements {
  sourceId: string
  intensity: number
  aiProbability: DeltaValue
  transformationMagnitude: DeltaValue
  grammarDamageNewErrorsPer1000: DeltaValue
  latencyMs: DeltaValue
  modelCalls: DeltaValue
  inputTokens: DeltaValue
  outputTokens: DeltaValue
  estimatedCostUsd: DeltaValue
  // Reuses the SAME DETERMINISTIC_EVALUATORS (A2H-04/05/09/10/13) the
  // ordinary output-scoped tests use, against a synthetic BenchmarkOutput
  // wrapping each arm's trial text — present only when the run has a locked
  // fixture set with coverage for this source; never fabricated otherwise.
  preservation: Partial<Record<A2HTestCode, DeltaValue>>
  productionCandidateSelection: { ranCandidateSearch: boolean; candidateCount: number; disqualifiedAt: string | null } | null
}

async function computePreservationDeltas(firestore: Firestore, run: BenchmarkRun, source: CorpusSource, intensity: number, singleText: string, productionText: string): Promise<Partial<Record<A2HTestCode, DeltaValue>>> {
  if (!run.fixtureSetId) return {}
  const fixturesBySource = await listFixturesForSource(firestore, run.fixtureSetId, source.id)
  const result: Partial<Record<A2HTestCode, DeltaValue>> = {}
  for (const code of PRESERVATION_CODES) {
    const evaluator = DETERMINISTIC_EVALUATORS[code]
    const fixtureType = FIXTURE_TYPE_FOR_TEST[code]
    if (!evaluator || !fixtureType) continue
    const fixtures: BenchmarkFixture[] = fixturesBySource.filter(f => f.type === fixtureType)
    if (fixtures.length === 0) continue
    const singleScore = evaluator({ run, source, output: buildSyntheticOutput(source, intensity, singleText), fixtures }).score
    const productionScore = evaluator({ run, source, output: buildSyntheticOutput(source, intensity, productionText), fixtures }).score
    result[code] = delta(singleScore, productionScore)
  }
  return result
}

export async function computeCandidateSelectionPairMeasurements(
  firestore: Firestore, run: BenchmarkRun, source: CorpusSource, intensity: number, single: BenchmarkTrial, production: BenchmarkTrial,
): Promise<CandidateSelectionPairMeasurements> {
  const singleGrammar: A2H08Measurements = evaluateGrammarDamage({ run, source, output: buildSyntheticOutput(source, intensity, single.outputText ?? ''), fixtures: [] }).measurements as unknown as A2H08Measurements
  const productionGrammar: A2H08Measurements = evaluateGrammarDamage({ run, source, output: buildSyntheticOutput(source, intensity, production.outputText ?? ''), fixtures: [] }).measurements as unknown as A2H08Measurements

  const preservation = single.outputText != null && production.outputText != null
    ? await computePreservationDeltas(firestore, run, source, intensity, single.outputText, production.outputText)
    : {}

  const prodCandidateSelection = production.diagnostics?.['candidateSelection'] as { ranCandidateSearch: boolean; candidateCount: number; disqualifiedAt: string | null } | undefined

  return {
    sourceId: source.id,
    intensity,
    aiProbability: delta(single.aiProbability, production.aiProbability),
    transformationMagnitude: delta(
      (single.diagnostics?.['transformationMagnitude'] as number | undefined) ?? null,
      (production.diagnostics?.['transformationMagnitude'] as number | undefined) ?? null,
    ),
    grammarDamageNewErrorsPer1000: delta(
      singleGrammar.eligible ? singleGrammar.newErrorsPer1000 : null,
      productionGrammar.eligible ? productionGrammar.newErrorsPer1000 : null,
    ),
    latencyMs: delta(single.latencyMs, production.latencyMs),
    modelCalls: delta(single.modelCalls, production.modelCalls),
    inputTokens: delta(single.inputTokens, production.inputTokens),
    outputTokens: delta(single.outputTokens, production.outputTokens),
    estimatedCostUsd: delta(single.estimatedCostUsd, production.estimatedCostUsd),
    preservation,
    productionCandidateSelection: prodCandidateSelection ?? null,
  }
}

export interface CandidateSelectionAggregate {
  n: number
  aiProbabilityDelta: ContinuousSummary
  transformationMagnitudeDelta: ContinuousSummary
  grammarDamageDelta: ContinuousSummary
  latencyDeltaMs: ContinuousSummary
  modelCallsDelta: ContinuousSummary
  candidateRejectionRate: number | null
  allDisqualifiedRate: number | null
  disqualifiedByStage: Record<string, number>
}

function summaryOf(values: Array<number | null>): ContinuousSummary {
  return summarizeContinuous(values.filter((v): v is number => v != null))
}

export function aggregateA2H15(pairs: CandidateSelectionPairMeasurements[]): CandidateSelectionAggregate {
  const withCandidateSearch = pairs.filter(p => p.productionCandidateSelection?.ranCandidateSearch)
  const allDisqualified = withCandidateSearch.filter(p => p.productionCandidateSelection!.disqualifiedAt != null)
  const disqualifiedByStage: Record<string, number> = {}
  for (const p of allDisqualified) {
    const stage = p.productionCandidateSelection!.disqualifiedAt!
    disqualifiedByStage[stage] = (disqualifiedByStage[stage] ?? 0) + 1
  }
  // "Rejection rate" here is the fraction of candidate-search trials where
  // the winning candidate was NOT the only one generated and at least one
  // sibling candidate was therefore rejected — i.e. every candidate-search
  // trial whose candidateCount > 1, since selectBestCandidate always
  // generates candidateCount candidates and ships exactly one.
  const withRejection = withCandidateSearch.filter(p => p.productionCandidateSelection!.candidateCount > 1)

  return {
    n: pairs.length,
    aiProbabilityDelta: summaryOf(pairs.map(p => p.aiProbability.delta)),
    transformationMagnitudeDelta: summaryOf(pairs.map(p => p.transformationMagnitude.delta)),
    grammarDamageDelta: summaryOf(pairs.map(p => p.grammarDamageNewErrorsPer1000.delta)),
    latencyDeltaMs: summaryOf(pairs.map(p => p.latencyMs.delta)),
    modelCallsDelta: summaryOf(pairs.map(p => p.modelCalls.delta)),
    candidateRejectionRate: withCandidateSearch.length === 0 ? null : withRejection.length / withCandidateSearch.length,
    allDisqualifiedRate: withCandidateSearch.length === 0 ? null : allDisqualified.length / withCandidateSearch.length,
    disqualifiedByStage,
  }
}

export interface A2H15Report {
  overall: CandidateSelectionAggregate
  pairs: CandidateSelectionPairMeasurements[]
}

// sourcesById is optional — a caller that already has the run's sources
// loaded (e.g. a batch report page) can pass it to skip the extra lookups;
// otherwise this resolves every distinct sourceId among the run's A2H-15
// trials itself.
export async function getA2H15Report(firestore: Firestore, runId: string, run: BenchmarkRun, sourcesById?: Map<string, CorpusSource>): Promise<A2H15Report> {
  const trials = await listTrialsForRun(firestore, runId, A2H15_CODE)
  const successful = trials.filter(t => t.status === 'success')
  const byPair = groupBy(successful, t => `${t.sourceId}__${t.condition['intensity'] as number}`)

  const resolvedSourcesById = sourcesById ?? new Map(
    (await Promise.all([...new Set(successful.map(t => t.sourceId))].map(async id => [id, await getSourceById(firestore, id)] as const)))
      .filter((entry): entry is [string, CorpusSource] => entry[1] != null),
  )

  const pairs: CandidateSelectionPairMeasurements[] = []
  for (const [, group] of byPair) {
    const single = group.find(t => t.condition['arm'] === 'single')
    const production = group.find(t => t.condition['arm'] === 'production')
    if (!single || !production) continue
    const source = resolvedSourcesById.get(single.sourceId)
    if (!source) continue
    const intensity = single.condition['intensity'] as number
    pairs.push(await computeCandidateSelectionPairMeasurements(firestore, run, source, intensity, single, production))
  }

  return { overall: aggregateA2H15(pairs), pairs }
}

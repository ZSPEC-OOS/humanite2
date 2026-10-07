import type { Domain } from '../vendor/style/types'
import { preprocess } from '../vendor/preprocess'
import { effectiveIntensity } from '../vendor/intensity'
import { measureIntensity } from '../vendor/evaluation/intensity'
import { candidateCountForIntensity } from '../vendor/selection/candidates'
import type { TargetCall, TargetCallResult } from '../shared/targetCalls'
import type { A2HTestCode } from '../shared/types'
import { summarizeContinuous, groupBy, type ContinuousSummary } from '../shared/statistics'
import { planHumanizeCall, sha256Hex, wordCount, type DetectorScore } from './trialCommon'

export const A2H15_CODE = 'A2H-15' as const

// A2H-15 — Candidate Selection Effectiveness. Compares production
// multi-candidate search/selection (ARM B) against a single-candidate
// baseline (ARM A) under matched source/intensity/tone/domain/model
// conditions — only candidate-selection behavior differs between arms.
// Requires an intensity that actually invokes candidate search
// (candidateCountForIntensity(intensity) > 1, i.e. intensity >= 4).

export const A2H15_PRESERVATION_CODES: readonly A2HTestCode[] = ['A2H-04', 'A2H-05', 'A2H-09', 'A2H-10', 'A2H-13']

export type A2H15Arm = 'single' | 'production'

export function a2h15ConditionId(intensity: number, arm: A2H15Arm): string {
  return `i${intensity}__${arm}`
}

export function parseA2H15ConditionId(id: string): { intensity: number; arm: A2H15Arm } | null {
  const m = /^i(\d+)__(single|production)$/.exec(id)
  if (!m) return null
  return { intensity: Number(m[1]), arm: m[2] as A2H15Arm }
}

export interface CandidateSelectionCondition {
  sourceId: string
  intensity: number
  arm: A2H15Arm
  conditionId: string
}

// Only intensities where candidateCountForIntensity actually invokes search
// (>= 4) produce a meaningful arm-B — a lower intensity's "production" arm
// would be identical to "single" by construction.
export function generateA2H15Conditions(sourceIds: string[], intensities: number[]): CandidateSelectionCondition[] {
  const conditions: CandidateSelectionCondition[] = []
  for (const sourceId of sourceIds) {
    for (const intensity of intensities.filter(i => candidateCountForIntensity(i) > 1)) {
      conditions.push({ sourceId, intensity, arm: 'single', conditionId: a2h15ConditionId(intensity, 'single') })
      conditions.push({ sourceId, intensity, arm: 'production', conditionId: a2h15ConditionId(intensity, 'production') })
    }
  }
  return conditions
}

// ── Plan / measure halves (Humanite's runA2H15Trial) ──────────────────────

export interface A2H15TrialInput {
  sourceId: string
  sourceText: string
  domain: Domain
  /** The REQUESTED intensity (1-10). */
  intensity: number
  arm: A2H15Arm
  model: string
  modelProvider: string
}

// One trial = one Humanize call. The single arm forces candidateCountOverride = 1; the production
// arm passes null (production's own selection). Everything else is identical between arms.
export function planA2H15Trial(input: A2H15TrialInput): TargetCall[] {
  return [planHumanizeCall(input.sourceText, input.intensity, input.domain, input.arm === 'single' ? 1 : null)]
}

// The candidate-selection telemetry Humanite's pipeline reported for a trial (ChunkResult). It is
// not part of the shared TargetCallResult vocabulary, so a target that can report it extends the
// result with these optional fields; when absent the measurement records null, never a guess.
export interface CandidateSelectionTelemetry { ranCandidateSearch: boolean; candidateCount: number; disqualifiedAt: string | null }

export interface A2H15TargetResult extends TargetCallResult {
  candidateSelection?: CandidateSelectionTelemetry | null
  gatesUnavailable?: boolean | null
  gatePassed?: boolean | null
}

export interface A2H15Trial {
  sourceId: string
  arm: A2H15Arm
  intensity: number
  condition: Record<string, unknown>
  status: 'success' | 'failed'
  outputText: string | null
  outputSha256: string | null
  outputWords: number | null
  modelProvider: string
  model: string
  latencyMs: number | null
  modelCalls: number | null
  retryCount: number
  candidateCount: number | null
  inputTokens: number | null
  outputTokens: number | null
  estimatedCostUsd: number | null
  aiProbability: number | null
  humanProbability: number | null
  classification: DetectorScore['classification'] | null
  diagnostics: Record<string, unknown> | null
  errorCode: string | null
  errorMessage: string | null
}

export interface A2H15Failure { errorCode: string; errorMessage: string }

// `detector` is the GPTZero score of the output (never called here). The recorded condition
// carries requested vs applied intensity from the pure domain-cap function, identical for both arms.
export function measureA2H15Trial(input: A2H15TrialInput, results: A2H15TargetResult[], detector: DetectorScore | null, failure?: A2H15Failure): A2H15Trial {
  const effective = effectiveIntensity(input.intensity, input.domain)
  const base = {
    sourceId: input.sourceId, arm: input.arm, intensity: input.intensity,
    condition: {
      sourceId: input.sourceId, intensity: input.intensity, arm: input.arm,
      requestedIntensity: effective.requested, appliedIntensity: effective.applied, intensityCapped: effective.capped,
    } as Record<string, unknown>,
    modelProvider: input.modelProvider,
    estimatedCostUsd: null,
  }
  const result = results[0]
  if (failure || !result) {
    return {
      ...base, status: 'failed', outputText: null, outputSha256: null, outputWords: null, model: input.model,
      latencyMs: result?.latencyMs ?? null, modelCalls: null, retryCount: 0, candidateCount: null, inputTokens: null, outputTokens: null,
      aiProbability: null, humanProbability: null, classification: null, diagnostics: null,
      errorCode: failure?.errorCode ?? 'UnknownError', errorMessage: failure?.errorMessage ?? 'Candidate-selection trial failed.',
    }
  }
  const factLockTexts = preprocess(input.sourceText).fact_locks.map(l => l.text)
  const transformationMagnitude = measureIntensity(input.sourceText, result.output, factLockTexts).transformationMagnitude
  return {
    ...base,
    status: 'success',
    outputText: result.output,
    outputSha256: sha256Hex(result.output),
    outputWords: wordCount(result.output),
    model: result.modelUsed ?? input.model,
    latencyMs: result.latencyMs,
    modelCalls: result.modelCalls,
    retryCount: result.retryCount,
    candidateCount: result.candidateCount ?? null,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    aiProbability: detector?.aiProbability ?? null,
    humanProbability: detector?.humanProbability ?? null,
    classification: detector?.classification ?? null,
    diagnostics: {
      transformationMagnitude,
      candidateSelection: result.candidateSelection ?? null,
      gatesUnavailable: result.gatesUnavailable ?? null,
      passed: result.gatePassed ?? null,
    },
    errorCode: null,
    errorMessage: null,
  }
}

// ── Pair measurement / aggregation ────────────────────────────────────────

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
  // Scores of the SAME deterministic preservation evaluators (A2H-04/05/09/10/13) on each arm's
  // text — present only when the caller supplies a scorer with fixture coverage for this source;
  // never fabricated otherwise.
  preservation: Partial<Record<A2HTestCode, DeltaValue>>
  productionCandidateSelection: CandidateSelectionTelemetry | null
}

// The fields of Humanite's BenchmarkTrial the pair measurement reads; an A2H15Trial (or a full
// BenchmarkTrial) is assignable.
export interface A2H15PairTrial {
  outputText: string | null
  aiProbability: number | null
  latencyMs: number | null
  modelCalls: number | null
  inputTokens: number | null
  outputTokens: number | null
  estimatedCostUsd: number | null
  diagnostics: Record<string, unknown> | null
}

// What A2H-08's grammar-damage evaluator returns for a text: the pair only uses these two fields.
export interface GrammarDamageScore { eligible: boolean; newErrorsPer1000: number }

export interface A2H15PairScorers {
  // A2H-08's evaluateGrammarDamage(...).measurements for the arm's text (called with '' when the
  // arm has no text, as the original did).
  grammarDamage: (text: string) => GrammarDamageScore
  // Optional. Score of each deterministic preservation evaluator (keyed by A2H code, for the codes
  // that have fixtures for this source) on a text; called only when BOTH arms have text.
  preservationScores?: (text: string) => Partial<Record<A2HTestCode, number | null>>
}

export function computeCandidateSelectionPairMeasurements(
  sourceId: string, intensity: number, single: A2H15PairTrial, production: A2H15PairTrial, scorers: A2H15PairScorers,
): CandidateSelectionPairMeasurements {
  const singleGrammar = scorers.grammarDamage(single.outputText ?? '')
  const productionGrammar = scorers.grammarDamage(production.outputText ?? '')

  const preservation: Partial<Record<A2HTestCode, DeltaValue>> = {}
  if (single.outputText != null && production.outputText != null && scorers.preservationScores) {
    const singleScores = scorers.preservationScores(single.outputText)
    const productionScores = scorers.preservationScores(production.outputText)
    for (const code of A2H15_PRESERVATION_CODES) {
      if (!(code in singleScores) || !(code in productionScores)) continue
      preservation[code] = delta(singleScores[code] ?? null, productionScores[code] ?? null)
    }
  }

  const prodCandidateSelection = production.diagnostics?.['candidateSelection'] as CandidateSelectionTelemetry | undefined | null

  return {
    sourceId,
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
  // "Rejection rate": the fraction of candidate-search trials whose candidateCount > 1, since
  // selectBestCandidate always generates candidateCount candidates and ships exactly one.
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

// The pure half of Humanite's getA2H15Report: pairs the SUCCESSFUL trials by (source, intensity)
// and measures each pair that has both arms. `scorersFor` supplies the per-source scorers; return
// null to skip a source (Humanite skipped pairs whose source could not be resolved).
export function buildA2H15Report(
  trials: Array<A2H15PairTrial & { sourceId: string; status: string; condition: Record<string, unknown> }>,
  scorersFor: (sourceId: string) => A2H15PairScorers | null,
): A2H15Report {
  const successful = trials.filter(t => t.status === 'success')
  const byPair = groupBy(successful, t => `${t.sourceId}__${t.condition['intensity'] as number}`)
  const pairs: CandidateSelectionPairMeasurements[] = []
  for (const [, group] of byPair) {
    const single = group.find(t => t.condition['arm'] === 'single')
    const production = group.find(t => t.condition['arm'] === 'production')
    if (!single || !production) continue
    const scorers = scorersFor(single.sourceId)
    if (!scorers) continue
    pairs.push(computeCandidateSelectionPairMeasurements(single.sourceId, single.condition['intensity'] as number, single, production, scorers))
  }
  return { overall: aggregateA2H15(pairs), pairs }
}

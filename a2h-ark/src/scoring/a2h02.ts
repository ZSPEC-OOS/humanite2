import type { Domain } from '../vendor/style/types'
import type { TargetCall, TargetCallResult } from '../shared/targetCalls'
import { measureIntensity } from '../vendor/evaluation/intensity'
import { effectiveIntensity } from '../vendor/intensity'
import type { CorpusSource } from '../shared/types'
import { summarizeContinuous, summarizeProportion, groupBy, pearsonCorrelation, type ContinuousSummary, type ProportionSummary } from '../shared/statistics'
import { planHumanizeCall, wordCount, type DetectorScore } from './trialCommon'

export const A2H02_CODE = 'A2H-02' as const

// A2H-02 — Intensity Response: the same frozen source, transformed at every
// selected intensity, measuring how much the transformation itself changed
// as intensity rises. transformationMagnitude reuses the deterministic,
// non-judge measureIntensity() (token-edit ratio, lexical replacement,
// sentence/paragraph boundary and order changes).
export interface A2H02Measurements {
  // `intensity` remains the REQUESTED value — A2H-02's primary strata stay
  // requested-intensity 1-10. requestedIntensity/appliedIntensity/
  // intensityCapped are carried alongside it so a plateau in a capped
  // domain (medical/legal at high requested settings) is visible.
  intensity: number
  requestedIntensity: number
  appliedIntensity: number
  intensityCapped: boolean
  aiProbability: number | null
  humanProbability: number | null
  classification: string
  sourceWords: number
  outputWords: number
  wordCountDelta: number
  wordCountDeltaPct: number
  transformationMagnitude: number
}

export interface A2H02OutputInfo {
  outputText: string
  outputWords: number
  intensity: number
  requestedIntensity: number
  appliedIntensity: number
  intensityCapped: boolean
}

// lockedTexts is passed as [] — CorpusSource doesn't persist the source's
// fact-locked spans, so lexicalReplacementRatio can't exclude them from its
// denominator here. A documented simplification, not a silent gap.
export function computeA2H02Measurements(
  source: Pick<CorpusSource, 'text' | 'actualWords'>,
  output: A2H02OutputInfo,
  postScore: Pick<DetectorScore, 'aiProbability' | 'humanProbability' | 'classification'>,
): A2H02Measurements {
  const metrics = measureIntensity(source.text, output.outputText, [])
  const wordCountDelta = output.outputWords - source.actualWords
  const wordCountDeltaPct = source.actualWords === 0 ? 0 : wordCountDelta / source.actualWords
  return {
    intensity: output.intensity,
    requestedIntensity: output.requestedIntensity,
    appliedIntensity: output.appliedIntensity,
    intensityCapped: output.intensityCapped,
    aiProbability: postScore.aiProbability,
    humanProbability: postScore.humanProbability,
    classification: postScore.classification,
    sourceWords: source.actualWords,
    outputWords: output.outputWords,
    wordCountDelta,
    wordCountDeltaPct,
    transformationMagnitude: metrics.transformationMagnitude,
  }
}

// ── Plan / measure halves (Humanite's output-generation stage, outputs.ts) ─

export interface A2H02TrialInput {
  source: Pick<CorpusSource, 'text' | 'actualWords' | 'domainId'>
  /** The REQUESTED intensity (1-10). */
  intensity: number
}

// One trial = one ordinary Humanize call at the requested intensity and the fixed tone. The same
// call (and so the same output) serves A2H-01 and A2H-02 for a (source, intensity).
export function planA2H02Trial(input: A2H02TrialInput): TargetCall[] {
  return [planHumanizeCall(input.source.text, input.intensity, input.source.domainId)]
}

// Requested vs applied intensity are recorded from Humanite's own pure cap function
// (effectiveIntensity(requested, domain)), exactly as outputs.ts recorded them — never from the
// target's answer — so a capped domain's plateau is visible. Returns null when the target
// produced no output.
export function measureA2H02Trial(
  input: A2H02TrialInput,
  results: TargetCallResult[],
  postScore: Pick<DetectorScore, 'aiProbability' | 'humanProbability' | 'classification'>,
): A2H02Measurements | null {
  const result = results[0]
  if (!result) return null
  const effective = effectiveIntensity(input.intensity, input.source.domainId)
  return computeA2H02Measurements(input.source, {
    outputText: result.output,
    outputWords: wordCount(result.output),
    intensity: input.intensity,
    requestedIntensity: effective.requested,
    appliedIntensity: effective.applied,
    intensityCapped: effective.capped,
  }, postScore)
}

export interface A2H02Aggregate {
  n: number
  transformationMagnitude: ContinuousSummary
  aiProbability: ContinuousSummary
  // The fraction classified human-written AFTER transformation at this
  // intensity — a standalone post-transform rate, distinct from A2H-01's
  // baseline-AI-eligibility-gated conversion rate.
  conversionRate: ProportionSummary
  classificationDistribution: Record<string, number>
  wordCountAbsChange: ContinuousSummary
  wordCountPctChange: ContinuousSummary
}

export function aggregateA2H02(measurements: A2H02Measurements[]): A2H02Aggregate {
  const aiProbs = measurements.map(m => m.aiProbability).filter((v): v is number => v != null)
  const humanCount = measurements.filter(m => m.classification === 'human-written').length
  const classificationDistribution: Record<string, number> = {}
  for (const m of measurements) classificationDistribution[m.classification] = (classificationDistribution[m.classification] ?? 0) + 1

  return {
    n: measurements.length,
    transformationMagnitude: summarizeContinuous(measurements.map(m => m.transformationMagnitude)),
    aiProbability: summarizeContinuous(aiProbs),
    conversionRate: summarizeProportion(humanCount, measurements.length),
    classificationDistribution,
    wordCountAbsChange: summarizeContinuous(measurements.map(m => Math.abs(m.wordCountDelta))),
    wordCountPctChange: summarizeContinuous(measurements.map(m => m.wordCountDeltaPct)),
  }
}

export interface IntensityTrendDiagnostics {
  correlation: number
  increasingSteps: number
  totalSteps: number
  lowBandMean: number
  midBandMean: number
  highBandMean: number
}

// Diagnostic checks for "does transformation magnitude reliably increase
// with intensity". Band boundaries (low 1-3, mid 4-7, high 8-10); a reduced
// intensity selection (a dry run) still works, since each band is computed
// only from whichever configured levels fall inside it.
export function computeIntensityTrendDiagnostics(meanMagnitudeByLevel: Map<number, number>): IntensityTrendDiagnostics | null {
  const levels = [...meanMagnitudeByLevel.keys()].sort((a, b) => a - b)
  if (levels.length < 2) return null

  const ys = levels.map(l => meanMagnitudeByLevel.get(l)!)
  const correlation = pearsonCorrelation(levels, ys)

  let increasingSteps = 0
  for (let i = 1; i < ys.length; i++) if (ys[i]! > ys[i - 1]!) increasingSteps++

  const bandMean = (start: number, end: number): number => {
    const values = levels.filter(l => l >= start && l <= end).map(l => meanMagnitudeByLevel.get(l)!)
    return values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : NaN
  }

  return {
    correlation,
    increasingSteps,
    totalSteps: ys.length - 1,
    lowBandMean: bandMean(1, 3),
    midBandMean: bandMean(4, 7),
    highBandMean: bandMean(8, 10),
  }
}

export interface A2H02Row {
  sourceId: string
  outputId: string
  domainId: Domain
  topicId: string
  targetWords: number
  intensity: number
  appliedIntensity: number
  intensityCapped: boolean
  model: string
  measurements: A2H02Measurements
}

export interface A2H02Filters {
  domainId?: Domain
  topicId?: string
  targetWords?: number
}

function matchesFilters(row: A2H02Row, filters?: A2H02Filters): boolean {
  if (!filters) return true
  if (filters.domainId && row.domainId !== filters.domainId) return false
  if (filters.topicId && row.topicId !== filters.topicId) return false
  if (filters.targetWords != null && row.targetWords !== filters.targetWords) return false
  return true
}

// The pure half of Humanite's getA2H02Rows: the row filter.
export function filterA2H02Rows(rows: A2H02Row[], filters?: A2H02Filters): A2H02Row[] {
  return rows.filter(row => matchesFilters(row, filters))
}

export interface A2H02Report {
  overall: A2H02Aggregate
  // Primary strata: requested intensity 1-10. A capped domain will show several requested levels
  // converging on the same applied configuration; that is the intended result, not a bug.
  byIntensity: Record<number, A2H02Aggregate>
  // Secondary breakdown by what Humanite ACTUALLY received after the production domain cap.
  byAppliedIntensity: Record<number, A2H02Aggregate>
  trend: IntensityTrendDiagnostics | null
  rows: A2H02Row[]
}

// The pure half of Humanite's getA2H02Report (rows in, grouped report out).
export function buildA2H02Report(allRows: A2H02Row[], filters?: A2H02Filters): A2H02Report {
  const rows = filterA2H02Rows(allRows, filters)
  const byIntensityGroups = groupBy(rows, r => r.intensity)
  const byIntensity: Record<number, A2H02Aggregate> = {}
  const meanMagnitudeByLevel = new Map<number, number>()
  for (const [intensity, group] of byIntensityGroups) {
    const agg = aggregateA2H02(group.map(r => r.measurements))
    byIntensity[intensity] = agg
    if (agg.transformationMagnitude.mean != null) meanMagnitudeByLevel.set(intensity, agg.transformationMagnitude.mean)
  }

  const byAppliedIntensityGroups = groupBy(rows, r => r.appliedIntensity)
  const byAppliedIntensity: Record<number, A2H02Aggregate> = {}
  for (const [appliedIntensity, group] of byAppliedIntensityGroups) {
    byAppliedIntensity[appliedIntensity] = aggregateA2H02(group.map(r => r.measurements))
  }

  return {
    overall: aggregateA2H02(rows.map(r => r.measurements)),
    byIntensity,
    byAppliedIntensity,
    trend: computeIntensityTrendDiagnostics(meanMagnitudeByLevel),
    rows,
  }
}

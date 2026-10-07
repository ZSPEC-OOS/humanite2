import type { Domain } from '../vendor/style/types'
import type { DetectionClassification } from '../vendor/detection/contracts'
import type { TargetCall, TargetCallResult } from '../shared/targetCalls'
import { summarizeContinuous, summarizeProportion, groupBy, type ContinuousSummary, type ProportionSummary } from '../shared/statistics'
import { planHumanizeCall, type DetectorScore } from './trialCommon'

export const A2H01_CODE = 'A2H-01' as const

// A2H-01 — GPTZero AI-to-Human Conversion, the flagship benchmark: for each
// selected frozen source, baseline -> Humanite output at intensity N ->
// post score, measuring how much (and whether) the transformation moved the
// text out of an AI classification.
export interface A2H01Measurements {
  aiProbabilityBefore: number | null
  aiProbabilityAfter: number | null
  humanProbabilityBefore: number | null
  humanProbabilityAfter: number | null
  mixedProbabilityBefore: number | null
  mixedProbabilityAfter: number | null
  classificationBefore: DetectionClassification
  classificationAfter: DetectionClassification
  deltaAiProbability: number | null
  eligibleForConversion: boolean
  convertedAiToHuman: boolean | null
  // Baselines are shared across runs by design, so a baseline may have been scored by an EARLIER
  // run: baselineOriginRunId is whichever run first produced this exact baseline;
  // baselineReusedAcrossRuns is true whenever that's not THIS run.
  baselineAnalyzedAt: string
  postAnalyzedAt: string
  baselineOriginRunId: string
  baselineReusedAcrossRuns: boolean
}

// deltaAiProbability = before - after (a positive value means the AI
// probability dropped, i.e. moved toward human). Eligibility is baseline-AI
// only — a baseline-Human or baseline-Mixed source is excluded from the
// primary conversion denominator entirely (it's not the population 'AI to
// Human conversion' is measuring), never counted as a non-conversion.
export function computeA2H01Measurements(baseline: DetectorScore, postScore: DetectorScore): A2H01Measurements {
  const deltaAiProbability = baseline.aiProbability != null && postScore.aiProbability != null
    ? baseline.aiProbability - postScore.aiProbability
    : null
  const eligibleForConversion = baseline.classification === 'ai-generated'
  const convertedAiToHuman = eligibleForConversion ? postScore.classification === 'human-written' : null

  return {
    aiProbabilityBefore: baseline.aiProbability,
    aiProbabilityAfter: postScore.aiProbability,
    humanProbabilityBefore: baseline.humanProbability,
    humanProbabilityAfter: postScore.humanProbability,
    mixedProbabilityBefore: baseline.mixedProbability,
    mixedProbabilityAfter: postScore.mixedProbability,
    classificationBefore: baseline.classification,
    classificationAfter: postScore.classification,
    deltaAiProbability,
    eligibleForConversion,
    convertedAiToHuman,
    baselineAnalyzedAt: baseline.analyzedAt,
    postAnalyzedAt: postScore.analyzedAt,
    baselineOriginRunId: baseline.runId,
    // postScore.runId IS the current run (a post-transform score is scoped
    // to a BenchmarkOutput, which is always run-scoped).
    baselineReusedAcrossRuns: baseline.runId !== postScore.runId,
  }
}

// ── Plan / measure halves (Humanite's output-generation stage, outputs.ts) ─

export interface A2H01TrialInput {
  sourceText: string
  domain: Domain
  /** The REQUESTED intensity (1-10). */
  intensity: number
}

// One trial = one ordinary Humanize call at the requested intensity and the fixed tone.
export function planA2H01Trial(input: A2H01TrialInput): TargetCall[] {
  return [planHumanizeCall(input.sourceText, input.intensity, input.domain)]
}

export interface A2H01TrialMeasurement {
  outputText: string
  measurements: A2H01Measurements
}

// `baseline` is the detector score of the frozen source; `postScore` the detector score of the
// output text this function returns in `outputText` (the pack scores it after the target answers).
// Returns null when the target produced no output (a failed transformation has nothing to score).
export function measureA2H01Trial(results: TargetCallResult[], baseline: DetectorScore, postScore: DetectorScore): A2H01TrialMeasurement | null {
  const result = results[0]
  if (!result) return null
  return { outputText: result.output, measurements: computeA2H01Measurements(baseline, postScore) }
}

export interface A2H01Aggregate {
  n: number
  nEligible: number
  nConverted: number
  conversionRate: ProportionSummary
  deltaAiProbability: ContinuousSummary
}

// deltaAiProbability's summary covers every row with a non-null delta,
// deliberately NOT restricted to eligible (baseline-AI) rows — "how much did
// AI probability move" is meaningful regardless of the baseline
// classification, whereas the conversion rate itself is strictly
// eligible-only per its own formula.
export function aggregateA2H01(measurements: A2H01Measurements[]): A2H01Aggregate {
  const eligible = measurements.filter(m => m.eligibleForConversion)
  const nConverted = eligible.filter(m => m.convertedAiToHuman === true).length
  const deltas = measurements.map(m => m.deltaAiProbability).filter((d): d is number => d != null)
  return {
    n: measurements.length,
    nEligible: eligible.length,
    nConverted,
    conversionRate: summarizeProportion(nConverted, eligible.length),
    deltaAiProbability: summarizeContinuous(deltas),
  }
}

export interface A2H01Row {
  sourceId: string
  outputId: string
  domainId: Domain
  topicId: string
  targetWords: number
  intensity: number
  model: string
  measurements: A2H01Measurements
}

export interface A2H01Filters {
  domainId?: Domain
  topicId?: string
  targetWords?: number
  intensity?: number
  classificationBefore?: DetectionClassification
  classificationAfter?: DetectionClassification
}

function matchesFilters(row: A2H01Row, filters?: A2H01Filters): boolean {
  if (!filters) return true
  if (filters.domainId && row.domainId !== filters.domainId) return false
  if (filters.topicId && row.topicId !== filters.topicId) return false
  if (filters.targetWords != null && row.targetWords !== filters.targetWords) return false
  if (filters.intensity != null && row.intensity !== filters.intensity) return false
  if (filters.classificationBefore && row.measurements.classificationBefore !== filters.classificationBefore) return false
  if (filters.classificationAfter && row.measurements.classificationAfter !== filters.classificationAfter) return false
  return true
}

// The pure half of Humanite's getA2H01Rows: the row filter.
export function filterA2H01Rows(rows: A2H01Row[], filters?: A2H01Filters): A2H01Row[] {
  return rows.filter(row => matchesFilters(row, filters))
}

export interface A2H01Report {
  overall: A2H01Aggregate
  byIntensity: Record<number, A2H01Aggregate>
  byDomain: Record<string, A2H01Aggregate>
  byLength: Record<number, A2H01Aggregate>
  byTopic: Record<string, A2H01Aggregate>
  byModel: Record<string, A2H01Aggregate>
  rows: A2H01Row[]
}

function groupedAggregate<K extends string | number>(rows: A2H01Row[], keyFn: (row: A2H01Row) => K): Record<K, A2H01Aggregate> {
  const groups = groupBy(rows, keyFn)
  const result = {} as Record<K, A2H01Aggregate>
  for (const [key, group] of groups) result[key] = aggregateA2H01(group.map(r => r.measurements))
  return result
}

// The pure half of Humanite's getA2H01Report (rows in, grouped report out).
export function buildA2H01Report(allRows: A2H01Row[], filters?: A2H01Filters): A2H01Report {
  const rows = filterA2H01Rows(allRows, filters)
  return {
    overall: aggregateA2H01(rows.map(r => r.measurements)),
    byIntensity: groupedAggregate(rows, r => r.intensity),
    byDomain: groupedAggregate(rows, r => r.domainId),
    byLength: groupedAggregate(rows, r => r.targetWords),
    byTopic: groupedAggregate(rows, r => r.topicId),
    byModel: groupedAggregate(rows, r => r.model),
    rows,
  }
}

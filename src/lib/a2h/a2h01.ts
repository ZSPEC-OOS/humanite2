import type { Firestore } from 'firebase-admin/firestore'
import type { Domain } from '@/lib/style/types'
import type { DetectionClassification } from '@/lib/detection/contracts'
import type { DetectorResult } from './types'
import { summarizeContinuous, summarizeProportion, groupBy, type ContinuousSummary, type ProportionSummary } from './statistics'
import { listTestResultsForRun } from './testResults'
import { listOutputsForRun } from './outputs'

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
}

// deltaAiProbability = before - after (a positive value means the AI
// probability dropped, i.e. moved toward human). Eligibility is baseline-AI
// only — a baseline-Human or baseline-Mixed source is excluded from the
// primary conversion denominator entirely (it's not the population 'AI to
// Human conversion' is measuring), never counted as a non-conversion.
export function computeA2H01Measurements(baseline: DetectorResult, postScore: DetectorResult): A2H01Measurements {
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
  }
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

// Reads already-persisted BenchmarkTestResult rows (written by the
// test_evaluation job stage — see execution.ts) joined against their
// BenchmarkOutput for context fields (domain/topic/length/intensity/model)
// that aren't duplicated onto the test result itself. Never recomputes a
// measurement from raw detector results — every number in the returned
// report is reproducible from, and traceable back to, these exact stored
// rows (§21).
export async function getA2H01Rows(firestore: Firestore, runId: string, filters?: A2H01Filters): Promise<A2H01Row[]> {
  const [testResults, outputs] = await Promise.all([
    listTestResultsForRun(firestore, runId, A2H01_CODE),
    listOutputsForRun(firestore, runId),
  ])
  const outputsById = new Map(outputs.map(o => [o.id, o]))

  const rows: A2H01Row[] = []
  for (const tr of testResults) {
    if (!tr.outputId) continue
    const output = outputsById.get(tr.outputId)
    if (!output) continue
    const row: A2H01Row = {
      sourceId: tr.sourceId,
      outputId: tr.outputId,
      domainId: output.domainId,
      topicId: output.topicId,
      targetWords: output.targetWords,
      intensity: output.intensity,
      model: output.model,
      measurements: tr.measurements as unknown as A2H01Measurements,
    }
    if (matchesFilters(row, filters)) rows.push(row)
  }
  return rows
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

export async function getA2H01Report(firestore: Firestore, runId: string, filters?: A2H01Filters): Promise<A2H01Report> {
  const rows = await getA2H01Rows(firestore, runId, filters)
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

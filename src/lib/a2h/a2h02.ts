import type { Firestore } from 'firebase-admin/firestore'
import type { Domain } from '@/lib/style/types'
import { measureIntensity } from '@/lib/evaluation/intensity'
import type { CorpusSource, DetectorResult } from './types'
import { summarizeContinuous, summarizeProportion, groupBy, pearsonCorrelation, type ContinuousSummary, type ProportionSummary } from './statistics'
import { listTestResultsForRun } from './testResults'
import { listOutputsForRun } from './outputs'

export const A2H02_CODE = 'A2H-02' as const

// A2H-02 — Intensity Response: the same frozen source, transformed at every
// selected intensity, measuring how much the transformation itself changed
// as intensity rises. transformationMagnitude reuses the existing,
// deterministic, non-judge measureIntensity() from
// src/lib/evaluation/intensity.ts (token-edit ratio, lexical replacement,
// sentence/paragraph boundary and order changes) — already production code,
// not something trapped in a test file, so this is reuse, not a rewrite.
export interface A2H02Measurements {
  intensity: number
  aiProbability: number | null
  humanProbability: number | null
  classification: string
  sourceWords: number
  outputWords: number
  wordCountDelta: number
  wordCountDeltaPct: number
  transformationMagnitude: number
}

// lockedTexts is passed as [] — CorpusSource doesn't persist the source's
// fact-locked spans, so lexicalReplacementRatio (one of the five ratios
// transformationMagnitude averages) can't exclude them from its
// denominator here the way the live Humanize pipeline's own evaluation
// does. A documented simplification, not a silent gap.
export function computeA2H02Measurements(source: CorpusSource, output: { outputText: string; outputWords: number; intensity: number }, postScore: DetectorResult): A2H02Measurements {
  const metrics = measureIntensity(source.text, output.outputText, [])
  const wordCountDelta = output.outputWords - source.actualWords
  const wordCountDeltaPct = source.actualWords === 0 ? 0 : wordCountDelta / source.actualWords
  return {
    intensity: output.intensity,
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

export interface A2H02Aggregate {
  n: number
  transformationMagnitude: ContinuousSummary
  aiProbability: ContinuousSummary
  // The fraction classified human-written AFTER transformation at this
  // intensity — a standalone post-transform rate, distinct from A2H-01's
  // baseline-AI-eligibility-gated conversion rate, since A2H-02 has no
  // "before" population to gate against.
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
// with intensity" — moved from tests/benchmark/tests/intensityAcceptance.test.ts
// (which now imports pearsonCorrelation from statistics.ts and this
// function) so the same trend logic backs both the acceptance test and this
// production report. Band boundaries (low 1-3, mid 4-7, high 8-10) match
// that test's own convention; a reduced intensity selection (a dry run)
// still works, since each band is computed only from whichever configured
// levels fall inside it.
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

export async function getA2H02Rows(firestore: Firestore, runId: string, filters?: A2H02Filters): Promise<A2H02Row[]> {
  const [testResults, outputs] = await Promise.all([
    listTestResultsForRun(firestore, runId, A2H02_CODE),
    listOutputsForRun(firestore, runId),
  ])
  const outputsById = new Map(outputs.map(o => [o.id, o]))

  const rows: A2H02Row[] = []
  for (const tr of testResults) {
    if (!tr.outputId) continue
    const output = outputsById.get(tr.outputId)
    if (!output) continue
    const row: A2H02Row = {
      sourceId: tr.sourceId,
      outputId: tr.outputId,
      domainId: output.domainId,
      topicId: output.topicId,
      targetWords: output.targetWords,
      intensity: output.intensity,
      model: output.model,
      measurements: tr.measurements as unknown as A2H02Measurements,
    }
    if (matchesFilters(row, filters)) rows.push(row)
  }
  return rows
}

export interface A2H02Report {
  overall: A2H02Aggregate
  byIntensity: Record<number, A2H02Aggregate>
  trend: IntensityTrendDiagnostics | null
  rows: A2H02Row[]
}

export async function getA2H02Report(firestore: Firestore, runId: string, filters?: A2H02Filters): Promise<A2H02Report> {
  const rows = await getA2H02Rows(firestore, runId, filters)
  const byIntensityGroups = groupBy(rows, r => r.intensity)
  const byIntensity: Record<number, A2H02Aggregate> = {}
  const meanMagnitudeByLevel = new Map<number, number>()
  for (const [intensity, group] of byIntensityGroups) {
    const agg = aggregateA2H02(group.map(r => r.measurements))
    byIntensity[intensity] = agg
    if (agg.transformationMagnitude.mean != null) meanMagnitudeByLevel.set(intensity, agg.transformationMagnitude.mean)
  }

  return {
    overall: aggregateA2H02(rows.map(r => r.measurements)),
    byIntensity,
    trend: computeIntensityTrendDiagnostics(meanMagnitudeByLevel),
    rows,
  }
}

import type { Firestore } from 'firebase-admin/firestore'
import type { Domain } from '@/lib/style/types'
import { summarizeContinuous, groupBy, type ContinuousSummary, type ProportionSummary } from './statistics'
import { aggregateA2H01, getA2H01Rows, type A2H01Row } from './a2h01'
import { getA2H02Rows, type A2H02Row } from './a2h02'

export type A2H03Stratum = 'domain' | 'topic' | 'intensity'

export interface A2H03Group {
  targetWords: number
  stratum: { dimension: A2H03Stratum; value: string | number } | null
  n: number
  conversionRate: ProportionSummary
  deltaAiProbability: ContinuousSummary
  transformationMagnitude: ContinuousSummary
  wordCountAbsChange: ContinuousSummary
}

function groupKey(row: A2H01Row | A2H02Row, stratifyBy?: A2H03Stratum): string {
  if (!stratifyBy) return String(row.targetWords)
  const stratumValue = stratifyBy === 'domain' ? row.domainId : stratifyBy === 'topic' ? row.topicId : row.intensity
  return `${row.targetWords}__${stratumValue}`
}

// A2H-03 — Length Performance: a pure aggregation of already-computed A2H-01
// (conversion/delta) and A2H-02 (transformation magnitude/word count)
// results by source.targetWords, per §18 — this function makes zero
// Humanite or GPTZero calls, and takes no client/apiKey/detector parameters
// at all, because it has nothing to call: every number here already exists
// in already-persisted BenchmarkTestResult rows for A2H-01/A2H-02. It is
// never itself a job stage (see jobs.ts) — there is no A2H-03 job to queue.
export function aggregateA2H03(a2h01Rows: A2H01Row[], a2h02Rows: A2H02Row[], stratifyBy?: A2H03Stratum): A2H03Group[] {
  const groups01 = groupBy(a2h01Rows, r => groupKey(r, stratifyBy))
  const groups02 = groupBy(a2h02Rows, r => groupKey(r, stratifyBy))
  const allKeys = new Set([...groups01.keys(), ...groups02.keys()])

  return [...allKeys].sort().map(key => {
    const rows01 = groups01.get(key) ?? []
    const rows02 = groups02.get(key) ?? []
    const sample = rows01[0] ?? rows02[0]!
    const agg01 = aggregateA2H01(rows01.map(r => r.measurements))

    return {
      targetWords: sample.targetWords,
      stratum: stratifyBy
        ? { dimension: stratifyBy, value: stratifyBy === 'domain' ? sample.domainId : stratifyBy === 'topic' ? sample.topicId : sample.intensity }
        : null,
      n: Math.max(rows01.length, rows02.length),
      conversionRate: agg01.conversionRate,
      deltaAiProbability: agg01.deltaAiProbability,
      transformationMagnitude: summarizeContinuous(rows02.map(r => r.measurements.transformationMagnitude)),
      wordCountAbsChange: summarizeContinuous(rows02.map(r => Math.abs(r.measurements.wordCountDelta))),
    }
  })
}

export interface A2H03Filters {
  domainId?: Domain
  topicId?: string
  intensity?: number
}

export interface A2H03Report {
  byLength: A2H03Group[]
  stratified: A2H03Group[] | null
}

// Reads the same already-persisted rows getA2H01Report/getA2H02Report do
// (never a fresh call to either detector or Humanite), optionally
// pre-filtered by domain/topic/intensity before grouping by length.
export async function getA2H03Report(firestore: Firestore, runId: string, filters?: A2H03Filters, stratifyBy?: A2H03Stratum): Promise<A2H03Report> {
  const [rows01, rows02] = await Promise.all([
    getA2H01Rows(firestore, runId, filters),
    getA2H02Rows(firestore, runId, filters),
  ])
  return {
    byLength: aggregateA2H03(rows01, rows02),
    stratified: stratifyBy ? aggregateA2H03(rows01, rows02, stratifyBy) : null,
  }
}

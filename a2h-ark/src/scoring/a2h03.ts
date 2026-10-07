import type { Domain } from '../vendor/style/types'
import { summarizeContinuous, groupBy, type ContinuousSummary, type ProportionSummary } from '../shared/statistics'
import { aggregateA2H01, filterA2H01Rows, type A2H01Row } from './a2h01'
import { filterA2H02Rows, type A2H02Row } from './a2h02'

export const A2H03_CODE = 'A2H-03' as const

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
// results by source.targetWords. It performs no target call and no detector call.
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

// The pure half of Humanite's getA2H03Report: the same filter object is applied to both row sets
// by each test's own matcher (so, as in Humanite, `intensity` filters A2H-01 rows only).
export function buildA2H03Report(allRows01: A2H01Row[], allRows02: A2H02Row[], filters?: A2H03Filters, stratifyBy?: A2H03Stratum): A2H03Report {
  const rows01 = filterA2H01Rows(allRows01, filters)
  const rows02 = filterA2H02Rows(allRows02, filters)
  return {
    byLength: aggregateA2H03(rows01, rows02),
    stratified: stratifyBy ? aggregateA2H03(rows01, rows02, stratifyBy) : null,
  }
}

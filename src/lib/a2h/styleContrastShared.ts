import { summarizeContinuous, type ContinuousSummary } from './statistics'

// Shared paired-arm delta/aggregate math for A2H-11 and A2H-14 (§45's
// "reusable comparison UI" applies just as much to the data layer feeding
// it — one implementation instead of two nearly-identical ones).

export interface StyleToneMetricDelta {
  left: number | null
  right: number | null
  delta: number | null
  movedExpectedDirection: boolean | null
}

export function metricDelta(left: number | null, right: number | null, expected?: 'higher_left' | 'higher_right'): StyleToneMetricDelta {
  if (left == null || right == null) return { left, right, delta: null, movedExpectedDirection: null }
  const delta = right - left
  let moved: boolean | null = null
  if (expected === 'higher_left') moved = left > right
  else if (expected === 'higher_right') moved = right > left
  return { left, right, delta, movedExpectedDirection: moved }
}

export interface StyleToneMetricAggregate {
  n: number
  meanDelta: number | null
  medianDelta: number | null
  sd: number | null
  ciLow95: number | null
  ciHigh95: number | null
  pctMovedExpectedDirection: number | null
}

export function aggregateMetric(deltas: StyleToneMetricDelta[]): StyleToneMetricAggregate {
  const present = deltas.filter(d => d.delta != null)
  const summary: ContinuousSummary = summarizeContinuous(present.map(d => d.delta!))
  const withDirection = deltas.filter(d => d.movedExpectedDirection != null)
  const movedCount = withDirection.filter(d => d.movedExpectedDirection).length
  return {
    n: summary.n,
    meanDelta: summary.mean,
    medianDelta: summary.median,
    sd: summary.sd,
    ciLow95: summary.ciLow95,
    ciHigh95: summary.ciHigh95,
    pctMovedExpectedDirection: withDirection.length === 0 ? null : movedCount / withDirection.length,
  }
}

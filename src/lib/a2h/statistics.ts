// Shared statistics primitives for every A2H test's aggregation — implemented
// once here so A2H-01/02/03 (and later A2H-04..17) report identical,
// consistently-defined summary numbers instead of three slightly different
// homegrown formulas scattered across React pages. Every raw helper operates
// on a plain number[] and is deliberately naive about domain meaning (it
// doesn't know "AI probability" from "word count") — that separation is what
// keeps this module trivially unit-testable against known values.

export interface ContinuousSummary {
  n: number
  mean: number | null
  median: number | null
  sd: number | null
  ciLow95: number | null
  ciHigh95: number | null
  min: number | null
  max: number | null
  p5: number | null
  p95: number | null
}

export interface ProportionSummary {
  n: number
  successCount: number
  failureCount: number
  successRate: number | null
  ciLow95: number | null
  ciHigh95: number | null
}

export function mean(values: number[]): number {
  if (values.length === 0) return NaN
  return values.reduce((a, b) => a + b, 0) / values.length
}

// Standard middle-value definition: the average of the two central values
// for an even-length array, the single central value for odd — distinct
// from percentile(values, 50), which instead linearly interpolates between
// ranked values and is used for P5/P95 in this module.
export function median(values: number[]): number {
  if (values.length === 0) return NaN
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!
}

// n=0 -> NaN (undefined), n=1 -> 0 (a single point has no spread) rather than
// NaN from a 0/0 division — both are deliberate, documented edge cases
// distinct from "the calculation is broken."
export function sampleStandardDeviation(values: number[]): number {
  const n = values.length
  if (n === 0) return NaN
  if (n === 1) return 0
  const m = mean(values)
  const sumSquares = values.reduce((sum, v) => sum + (v - m) ** 2, 0)
  return Math.sqrt(sumSquares / (n - 1))
}

// Linear-interpolation percentile (the common "R-7"/NumPy-default method):
// rank = p/100 * (n-1), interpolating between the two bracketing sorted
// values when rank isn't a whole number. p is 0-100, not 0-1.
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return NaN
  if (p < 0 || p > 100) throw new Error('percentile must be between 0 and 100')
  const sorted = [...values].sort((a, b) => a - b)
  if (sorted.length === 1) return sorted[0]!
  const rank = (p / 100) * (sorted.length - 1)
  const lowerIndex = Math.floor(rank)
  const upperIndex = Math.ceil(rank)
  if (lowerIndex === upperIndex) return sorted[lowerIndex]!
  const fraction = rank - lowerIndex
  return sorted[lowerIndex]! + fraction * (sorted[upperIndex]! - sorted[lowerIndex]!)
}

// Normal approximation (z = 1.96) around the sample mean — a deliberate
// simplification over an exact t-distribution interval, which would need a
// t-table or a gamma-function implementation this codebase has no other use
// for. Acceptable for the sample sizes an A2H run produces (dozens to
// thousands per cell), where t and z intervals are nearly identical.
export function confidenceIntervalMean95(values: number[]): [number, number] {
  const n = values.length
  if (n === 0) return [NaN, NaN]
  const m = mean(values)
  if (n === 1) return [m, m]
  const sd = sampleStandardDeviation(values)
  const marginOfError = 1.96 * (sd / Math.sqrt(n))
  return [m - marginOfError, m + marginOfError]
}

// Wilson score interval — unlike the naive normal approximation
// (p ± 1.96*sqrt(p(1-p)/n)), this stays within [0, 1] and remains
// well-behaved for proportions near 0 or 1 or for small n, both of which are
// realistic for a benchmark's per-cell conversion rates.
export function proportionConfidenceInterval95(successCount: number, n: number): [number, number] {
  if (n === 0) return [NaN, NaN]
  if (successCount < 0 || successCount > n) throw new Error('successCount must be between 0 and n')
  const z = 1.96
  const p = successCount / n
  const denominator = 1 + (z * z) / n
  const center = p + (z * z) / (2 * n)
  const margin = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))
  // Clamp away floating-point overshoot at the boundaries (e.g. successCount=0
  // can compute a low bound a hair below zero) — the interval is
  // mathematically guaranteed within [0, 1]; only rounding error isn't.
  const low = Math.max(0, (center - margin) / denominator)
  const high = Math.min(1, (center + margin) / denominator)
  return [low, high]
}

// SD relative to the mean — undefined (NaN) when the mean is exactly 0,
// since the ratio is meaningless there rather than merely large.
export function coefficientOfVariation(values: number[]): number {
  const m = mean(values)
  if (m === 0) return NaN
  return sampleStandardDeviation(values) / m
}

export function summarizeContinuous(values: number[]): ContinuousSummary {
  const n = values.length
  if (n === 0) {
    return { n: 0, mean: null, median: null, sd: null, ciLow95: null, ciHigh95: null, min: null, max: null, p5: null, p95: null }
  }
  const [ciLow95, ciHigh95] = confidenceIntervalMean95(values)
  return {
    n,
    mean: mean(values),
    median: median(values),
    sd: sampleStandardDeviation(values),
    ciLow95,
    ciHigh95,
    min: Math.min(...values),
    max: Math.max(...values),
    p5: percentile(values, 5),
    p95: percentile(values, 95),
  }
}

// Moved here from tests/benchmark/tests/intensityAcceptance.test.ts (that
// file now imports it) — the Pearson correlation between two equal-length
// series is general-purpose statistics, not something that belongs trapped
// inside one Vitest acceptance file. Used by A2H-02's intensity-response
// trend diagnostics (correlation between intensity level and mean
// transformation magnitude).
export function pearsonCorrelation(xs: number[], ys: number[]): number {
  if (xs.length !== ys.length) throw new Error('pearsonCorrelation requires equal-length arrays')
  const n = xs.length
  if (n === 0) return NaN
  const meanX = mean(xs)
  const meanY = mean(ys)
  let cov = 0
  let varX = 0
  let varY = 0
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - meanX
    const dy = ys[i]! - meanY
    cov += dx * dy
    varX += dx * dx
    varY += dy * dy
  }
  return cov / Math.sqrt(varX * varY)
}

// A small general-purpose grouping helper shared by every A2H test's
// breakdown-by-dimension reporting (by intensity, by domain, by length, by
// topic, by model, ...) — one implementation instead of the same reduce
// re-written in each test module.
export function groupBy<T, K>(items: T[], keyFn: (item: T) => K): Map<K, T[]> {
  const map = new Map<K, T[]>()
  for (const item of items) {
    const key = keyFn(item)
    const list = map.get(key)
    if (list) list.push(item)
    else map.set(key, [item])
  }
  return map
}

export function summarizeProportion(successCount: number, n: number): ProportionSummary {
  if (n === 0) {
    return { n: 0, successCount: 0, failureCount: 0, successRate: null, ciLow95: null, ciHigh95: null }
  }
  const [ciLow95, ciHigh95] = proportionConfidenceInterval95(successCount, n)
  return {
    n,
    successCount,
    failureCount: n - successCount,
    successRate: successCount / n,
    ciLow95,
    ciHigh95,
  }
}

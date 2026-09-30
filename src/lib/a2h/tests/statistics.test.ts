import { describe, it, expect } from 'vitest'
import {
  mean, median, sampleStandardDeviation, percentile,
  confidenceIntervalMean95, proportionConfidenceInterval95, coefficientOfVariation,
  summarizeContinuous, summarizeProportion,
} from '../statistics'

describe('mean', () => {
  it('computes the arithmetic mean of known values', () => {
    expect(mean([1, 2, 3, 4, 5])).toBe(3)
    expect(mean([10, 20])).toBe(15)
  })

  it('returns NaN for an empty array', () => {
    expect(mean([])).toBeNaN()
  })
})

describe('median', () => {
  it('returns the middle value for an odd-length array', () => {
    expect(median([5, 1, 3])).toBe(3)
  })

  it('averages the two central values for an even-length array', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5)
  })

  it('returns NaN for an empty array', () => {
    expect(median([])).toBeNaN()
  })
})

describe('sampleStandardDeviation', () => {
  it('matches the known sample SD for [2, 4, 4, 4, 5, 5, 7, 9]', () => {
    // mean=5; sum of squared deviations = 9+1+1+1+0+0+4+16 = 32;
    // sample variance = 32/(8-1) = 32/7; SD = sqrt(32/7).
    expect(sampleStandardDeviation([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(Math.sqrt(32 / 7), 10)
  })

  it('returns 0 for a single value', () => {
    expect(sampleStandardDeviation([42])).toBe(0)
  })

  it('returns NaN for an empty array', () => {
    expect(sampleStandardDeviation([])).toBeNaN()
  })
})

describe('percentile', () => {
  it('matches the linear-interpolation method for known values', () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    expect(percentile(values, 50)).toBeCloseTo(5.5, 10)
    expect(percentile(values, 0)).toBe(1)
    expect(percentile(values, 100)).toBe(10)
    // rank = 0.05 * 9 = 0.45 -> interpolate between values[0]=1 and values[1]=2
    expect(percentile(values, 5)).toBeCloseTo(1.45, 10)
  })

  it('returns the single value for a single-element array', () => {
    expect(percentile([42], 50)).toBe(42)
  })

  it('throws for a percentile outside 0..100', () => {
    expect(() => percentile([1, 2], -1)).toThrow()
    expect(() => percentile([1, 2], 101)).toThrow()
  })

  it('returns NaN for an empty array', () => {
    expect(percentile([], 50)).toBeNaN()
  })
})

describe('confidenceIntervalMean95', () => {
  it('is centered on the mean and symmetric', () => {
    const values = [2, 4, 4, 4, 5, 5, 7, 9]
    const [low, high] = confidenceIntervalMean95(values)
    const m = mean(values)
    expect(high - m).toBeCloseTo(m - low, 10)
    expect(low).toBeLessThan(m)
    expect(high).toBeGreaterThan(m)
  })

  it('collapses to [mean, mean] for a single value', () => {
    expect(confidenceIntervalMean95([42])).toEqual([42, 42])
  })

  it('returns [NaN, NaN] for an empty array', () => {
    const [low, high] = confidenceIntervalMean95([])
    expect(low).toBeNaN()
    expect(high).toBeNaN()
  })

  it('widens as SD increases at fixed n', () => {
    const tight = confidenceIntervalMean95([10, 10, 10, 10])
    const wide = confidenceIntervalMean95([1, 10, 20, 30])
    expect(wide[1] - wide[0]).toBeGreaterThan(tight[1] - tight[0])
  })
})

describe('proportionConfidenceInterval95', () => {
  it('stays within [0, 1] even for a proportion near the boundary', () => {
    const [low, high] = proportionConfidenceInterval95(1, 1)
    expect(low).toBeGreaterThanOrEqual(0)
    expect(high).toBeLessThanOrEqual(1)
  })

  it('stays within [0, 1] for zero successes', () => {
    const [low, high] = proportionConfidenceInterval95(0, 10)
    expect(low).toBeGreaterThanOrEqual(0)
    expect(high).toBeLessThanOrEqual(1)
    expect(low).toBe(0)
  })

  it('matches a known Wilson interval for 50/100', () => {
    const [low, high] = proportionConfidenceInterval95(50, 100)
    // Known Wilson 95% interval for p=0.5, n=100 is approximately [0.404, 0.596].
    expect(low).toBeCloseTo(0.404, 2)
    expect(high).toBeCloseTo(0.596, 2)
  })

  it('narrows as n increases at a fixed proportion', () => {
    const small = proportionConfidenceInterval95(5, 10)
    const large = proportionConfidenceInterval95(500, 1000)
    expect(large[1] - large[0]).toBeLessThan(small[1] - small[0])
  })

  it('returns [NaN, NaN] for n=0', () => {
    const [low, high] = proportionConfidenceInterval95(0, 0)
    expect(low).toBeNaN()
    expect(high).toBeNaN()
  })

  it('throws when successCount is out of range', () => {
    expect(() => proportionConfidenceInterval95(-1, 10)).toThrow()
    expect(() => proportionConfidenceInterval95(11, 10)).toThrow()
  })
})

describe('coefficientOfVariation', () => {
  it('computes SD/mean for known values', () => {
    // mean=5, sd=sqrt(32/7) (from the sampleStandardDeviation example)
    expect(coefficientOfVariation([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(Math.sqrt(32 / 7) / 5, 10)
  })

  it('returns NaN when the mean is 0', () => {
    expect(coefficientOfVariation([-1, 0, 1])).toBeNaN()
  })
})

describe('summarizeContinuous', () => {
  it('reports every field for a non-empty array', () => {
    const summary = summarizeContinuous([2, 4, 4, 4, 5, 5, 7, 9])
    expect(summary.n).toBe(8)
    expect(summary.mean).toBe(5)
    expect(summary.sd).toBeCloseTo(Math.sqrt(32 / 7), 10)
    expect(summary.min).toBe(2)
    expect(summary.max).toBe(9)
  })

  it('returns an all-null summary with n=0 for an empty array', () => {
    const summary = summarizeContinuous([])
    expect(summary).toEqual({ n: 0, mean: null, median: null, sd: null, ciLow95: null, ciHigh95: null, min: null, max: null, p5: null, p95: null })
  })
})

describe('summarizeProportion', () => {
  it('reports every field for n > 0', () => {
    const summary = summarizeProportion(7, 10)
    expect(summary.n).toBe(10)
    expect(summary.successCount).toBe(7)
    expect(summary.failureCount).toBe(3)
    expect(summary.successRate).toBe(0.7)
  })

  it('returns an all-null/zero summary for n=0', () => {
    const summary = summarizeProportion(0, 0)
    expect(summary).toEqual({ n: 0, successCount: 0, failureCount: 0, successRate: null, ciLow95: null, ciHigh95: null })
  })
})

import { describe, it, expect } from 'vitest'
import { sampleForPairwiseRating } from '../humanRatings/sample'
import { hasSufficientRatings, summarizePairwiseRatings, MIN_RATINGS_FOR_SIGNIFICANCE, HUMAN_RATINGS } from '../humanRatings'
import { DOMAINS } from '../types'
import { TONES } from '@/lib/style'
import { SCALE_UP_INTENSITIES } from '../runBenchmark'

describe('sampleForPairwiseRating', () => {
  it('produces one task per domain x tone x intensity stratum at perStratum=1', () => {
    const tasks = sampleForPairwiseRating(1)
    expect(tasks).toHaveLength(DOMAINS.length * TONES.length * SCALE_UP_INTENSITIES.length)
  })

  it('is deterministic across repeated calls', () => {
    expect(sampleForPairwiseRating(2)).toEqual(sampleForPairwiseRating(2))
  })

  it('only selects items whose domain matches the stratum', () => {
    for (const task of sampleForPairwiseRating(1)) {
      expect(DOMAINS).toContain(task.domain)
    }
  })

  it('scales the sample size with perStratum', () => {
    const single = sampleForPairwiseRating(1)
    const doubled = sampleForPairwiseRating(2)
    expect(doubled.length).toBeGreaterThan(single.length)
  })
})

describe('human pairwise ratings — intentionally unpopulated', () => {
  it('starts empty, since no real human rater has rated anything yet', () => {
    expect(HUMAN_RATINGS).toEqual([])
  })

  it('reports insufficient data rather than fabricating a rate', () => {
    expect(hasSufficientRatings()).toBe(false)
    expect(summarizePairwiseRatings()).toBeNull()
  })

  it('MIN_RATINGS_FOR_SIGNIFICANCE is a positive threshold', () => {
    expect(MIN_RATINGS_FOR_SIGNIFICANCE).toBeGreaterThan(0)
  })
})

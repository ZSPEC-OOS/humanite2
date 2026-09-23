import { describe, it, expect } from 'vitest'
import { computeRepetitionStats } from '../repetition'

describe('computeRepetitionStats', () => {
  it('returns all zeros for empty text', () => {
    expect(computeRepetitionStats('')).toEqual({
      repeated_bigram_rate: 0,
      repeated_trigram_rate: 0,
    })
  })

  it('reports zero repetition when every bigram and trigram is unique', () => {
    const stats = computeRepetitionStats('the quick brown fox jumps over the lazy dog')
    // "the quick", "quick brown", ... none repeat until "the" reappears,
    // but "the lazy" is still a new bigram — no exact bigram repeats here.
    expect(stats.repeated_bigram_rate).toBe(0)
  })

  it('detects a repeated bigram', () => {
    const stats = computeRepetitionStats('in the end it was fine in the end')
    // bigrams: "in the", "the end", "end it", "it was", "was fine", "fine in", "in the", "the end"
    // 8 bigrams total, 2 are repeats ("in the", "the end")
    expect(stats.repeated_bigram_rate).toBeCloseTo(2 / 8, 4)
  })

  it('detects a repeated trigram', () => {
    const stats = computeRepetitionStats('at the end of the day at the end of the story')
    const words = 'at the end of the day at the end of the story'.split(' ')
    const trigramCount = words.length - 2
    expect(stats.repeated_trigram_rate).toBeGreaterThan(0)
    expect(stats.repeated_trigram_rate).toBeLessThanOrEqual(1)
    expect(trigramCount).toBeGreaterThan(0)
  })

  it('returns zero rather than dividing by zero when there are fewer than n words', () => {
    expect(computeRepetitionStats('one').repeated_bigram_rate).toBe(0)
    expect(computeRepetitionStats('one two').repeated_trigram_rate).toBe(0)
  })
})

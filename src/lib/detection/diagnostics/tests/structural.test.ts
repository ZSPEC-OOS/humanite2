import { describe, it, expect } from 'vitest'
import { computeStructuralStats } from '../structural'

describe('computeStructuralStats', () => {
  it('returns all zeros for empty text', () => {
    expect(computeStructuralStats('')).toEqual({
      word_count: 0,
      sentence_count: 0,
      paragraph_count: 0,
      average_sentence_length: 0,
      sentence_length_stddev: 0,
      question_rate: 0,
    })
  })

  it('counts words, sentences, and paragraphs', () => {
    const text = 'The first sentence is here. The second sentence follows it.\n\nA new paragraph starts now.'
    const stats = computeStructuralStats(text)
    expect(stats.sentence_count).toBe(3)
    expect(stats.paragraph_count).toBe(2)
    expect(stats.word_count).toBe(15)
  })

  it('computes average sentence length and a non-zero stddev when lengths vary', () => {
    // 6 words, then 2 words — clearly unequal sentence lengths.
    const text = 'One two three four five six. Seven eight.'
    const stats = computeStructuralStats(text)
    expect(stats.average_sentence_length).toBe(4)
    expect(stats.sentence_length_stddev).toBeGreaterThan(0)
  })

  it('reports zero stddev when every sentence is the same length', () => {
    const text = 'One two three. Four five six. Seven eight nine.'
    const stats = computeStructuralStats(text)
    expect(stats.sentence_length_stddev).toBe(0)
  })

  it('computes question_rate from sentences ending in a question mark', () => {
    const text = 'Is this a question? This is not. Is this one too?'
    const stats = computeStructuralStats(text)
    expect(stats.sentence_count).toBe(3)
    expect(stats.question_rate).toBeCloseTo(2 / 3, 4)
  })
})

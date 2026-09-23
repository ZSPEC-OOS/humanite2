import { describe, it, expect } from 'vitest'
import { calculateLocalDiagnostics } from '../index'

describe('calculateLocalDiagnostics', () => {
  it('assembles every LocalDiagnostics field from a single pass', () => {
    const text = "I think we're doing great! Don't you agree? The team improved steadily this quarter."
    const result = calculateLocalDiagnostics(text)

    expect(result).toEqual({
      word_count: expect.any(Number),
      sentence_count: expect.any(Number),
      paragraph_count: expect.any(Number),
      average_sentence_length: expect.any(Number),
      sentence_length_stddev: expect.any(Number),
      lexical_diversity: expect.any(Number),
      contraction_rate: expect.any(Number),
      first_person_rate: expect.any(Number),
      repeated_bigram_rate: expect.any(Number),
      repeated_trigram_rate: expect.any(Number),
      question_rate: expect.any(Number),
      readability_score: expect.any(Number),
    })
  })

  it('never derives an AI-likelihood field — only descriptive writing stats', () => {
    const result = calculateLocalDiagnostics('Some ordinary sentence for testing purposes.')
    const keys = Object.keys(result)
    for (const forbidden of ['ai_probability', 'classification', 'confidence']) {
      expect(keys).not.toContain(forbidden)
    }
  })

  it('handles empty input without throwing', () => {
    expect(() => calculateLocalDiagnostics('')).not.toThrow()
    expect(calculateLocalDiagnostics('').readability_score).toBeNull()
  })
})

import { describe, it, expect } from 'vitest'
import { computeLexicalStats } from '../lexical'

describe('computeLexicalStats', () => {
  it('returns all zeros for empty text', () => {
    expect(computeLexicalStats('')).toEqual({
      lexical_diversity: 0,
      contraction_rate: 0,
      first_person_rate: 0,
    })
  })

  it('computes lexical_diversity as the unique-word ratio', () => {
    // "the the the" -> 1 unique / 3 total
    expect(computeLexicalStats('the the the').lexical_diversity).toBeCloseTo(1 / 3, 4)
    // all-unique words -> 1.0
    expect(computeLexicalStats('one two three').lexical_diversity).toBe(1)
  })

  it('detects common contractions', () => {
    const stats = computeLexicalStats("I don't think it's true, we're not sure")
    expect(stats.contraction_rate).toBeGreaterThan(0)
  })

  it('reports zero contraction_rate when there are none', () => {
    expect(computeLexicalStats('The cat sat on the mat').contraction_rate).toBe(0)
  })

  it('counts first-person pronouns', () => {
    const stats = computeLexicalStats('I think we should go to our house')
    // I, we, our = 3 of 8 words
    expect(stats.first_person_rate).toBeCloseTo(3 / 8, 4)
  })

  it('reports zero first_person_rate for third-person text', () => {
    const stats = computeLexicalStats('She thinks they should go to their house')
    expect(stats.first_person_rate).toBe(0)
  })
})

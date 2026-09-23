import { describe, it, expect } from 'vitest'
import { computeReadabilityScore } from '../readability'

describe('computeReadabilityScore', () => {
  it('returns null for empty text', () => {
    expect(computeReadabilityScore('')).toBeNull()
  })

  it('returns null for text with no recognizable words', () => {
    expect(computeReadabilityScore('...')).toBeNull()
  })

  it('scores simple, short-sentence text higher than dense, long-sentence text', () => {
    const simple = computeReadabilityScore(
      'The cat sat on the mat. The dog ran fast. She ate a pear.',
    )
    const dense = computeReadabilityScore(
      'The comprehensive multifaceted organizational restructuring initiative necessitated ' +
      'extraordinarily sophisticated interdisciplinary collaboration among numerous stakeholders.',
    )
    expect(simple).not.toBeNull()
    expect(dense).not.toBeNull()
    expect(simple!).toBeGreaterThan(dense!)
  })

  it('returns a finite number for ordinary prose', () => {
    const score = computeReadabilityScore('This is a normal sentence with a reasonable length.')
    expect(typeof score).toBe('number')
    expect(Number.isFinite(score)).toBe(true)
  })
})

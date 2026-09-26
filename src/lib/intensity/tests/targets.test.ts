import { describe, it, expect } from 'vitest'
import { INTENSITY_TARGETS, intensityTarget } from '../targets'

describe('INTENSITY_TARGETS', () => {
  it('defines exactly 10 levels', () => {
    expect(Object.keys(INTENSITY_TARGETS)).toHaveLength(10)
  })

  it('increases lexical, sentence, paragraph, and discourse targets monotonically from level 1 to 10', () => {
    for (let level = 2; level <= 10; level++) {
      const prev = INTENSITY_TARGETS[level - 1]!
      const curr = INTENSITY_TARGETS[level]!
      expect(curr.lexical, `level ${level} lexical`).toBeGreaterThan(prev.lexical)
      expect(curr.sentence, `level ${level} sentence`).toBeGreaterThan(prev.sentence)
      expect(curr.paragraph, `level ${level} paragraph`).toBeGreaterThanOrEqual(prev.paragraph)
      expect(curr.discourse, `level ${level} discourse`).toBeGreaterThanOrEqual(prev.discourse)
    }
  })

  it('never fabricates a syntactic target — every level reports null', () => {
    for (const target of Object.values(INTENSITY_TARGETS)) {
      expect(target.syntactic).toBeNull()
    }
  })
})

describe('intensityTarget', () => {
  it('returns the exact target for a valid integer level', () => {
    expect(intensityTarget(7)).toBe(INTENSITY_TARGETS[7])
  })

  it('clamps below 1 up to level 1', () => {
    expect(intensityTarget(0)).toBe(INTENSITY_TARGETS[1])
    expect(intensityTarget(-5)).toBe(INTENSITY_TARGETS[1])
  })

  it('clamps above 10 down to level 10', () => {
    expect(intensityTarget(11)).toBe(INTENSITY_TARGETS[10])
  })

  it('rounds a non-integer level to the nearest defined one', () => {
    expect(intensityTarget(6.6)).toBe(INTENSITY_TARGETS[7])
  })
})

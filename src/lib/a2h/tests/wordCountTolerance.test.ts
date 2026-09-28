import { describe, it, expect } from 'vitest'
import { toleranceFor, isWithinTolerance } from '../wordCountTolerance'

describe('toleranceFor', () => {
  it('is 5% at and below 300 words', () => {
    expect(toleranceFor(100)).toBe(0.05)
    expect(toleranceFor(300)).toBe(0.05)
  })

  it('is 4% between 301 and 1000 words', () => {
    expect(toleranceFor(500)).toBe(0.04)
    expect(toleranceFor(1000)).toBe(0.04)
  })

  it('is 3% above 1000 words', () => {
    expect(toleranceFor(1250)).toBe(0.03)
    expect(toleranceFor(2000)).toBe(0.03)
  })
})

describe('isWithinTolerance', () => {
  it('accepts exact matches at every band', () => {
    expect(isWithinTolerance(100, 100)).toBe(true)
    expect(isWithinTolerance(1000, 1000)).toBe(true)
    expect(isWithinTolerance(2000, 2000)).toBe(true)
  })

  it('accepts a value at the edge of its band and rejects just past it', () => {
    // 100 words, 5% tolerance -> 105 is the edge, 106 is not
    expect(isWithinTolerance(100, 105)).toBe(true)
    expect(isWithinTolerance(100, 106)).toBe(false)
    // 2000 words, 3% tolerance -> 2060 is the edge, 2061 is not
    expect(isWithinTolerance(2000, 2060)).toBe(true)
    expect(isWithinTolerance(2000, 2061)).toBe(false)
  })

  it('rejects a value far outside tolerance in either direction', () => {
    expect(isWithinTolerance(500, 300)).toBe(false)
    expect(isWithinTolerance(500, 800)).toBe(false)
  })
})

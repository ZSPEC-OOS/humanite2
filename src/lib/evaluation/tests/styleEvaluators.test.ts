import { describe, it, expect } from 'vitest'
import { evaluateTone, evaluateDomain, evaluateNaturalness, evaluateIntensityAlignment, evaluateStyle } from '../styleEvaluators'

describe('evaluateTone / evaluateDomain — threshold wrappers', () => {
  it('passes at or above the 0.6 threshold', () => {
    expect(evaluateTone(0.6)).toEqual({ score: 0.6, passed: true })
    expect(evaluateDomain(0.6)).toEqual({ score: 0.6, passed: true })
  })

  it('fails below the threshold', () => {
    expect(evaluateTone(0.59)).toEqual({ score: 0.59, passed: false })
  })

  it('reports null (not measured), not a false pass or fail, when the score is null', () => {
    expect(evaluateTone(null)).toEqual({ score: null, passed: null })
  })
})

describe('evaluateNaturalness — reported but never gating', () => {
  it('always returns passed: null, whatever the score', () => {
    expect(evaluateNaturalness(0.1).passed).toBeNull()
    expect(evaluateNaturalness(0.9).passed).toBeNull()
    expect(evaluateNaturalness(null).passed).toBeNull()
  })

  it('still reports the raw score for visibility', () => {
    expect(evaluateNaturalness(0.42).score).toBe(0.42)
  })
})

describe('evaluateIntensityAlignment — floor check against the level design target', () => {
  it('scores 1.0 when the actual magnitude meets or exceeds the target', () => {
    // Level 1's target mean (lexical .05, sentence .03, paragraph .00) is
    // small — any reasonably-transformed output clears it easily.
    const result = evaluateIntensityAlignment(0.5, 1)
    expect(result.score).toBe(1)
    expect(result.passed).toBe(true)
  })

  it('scores proportionally below 1.0 when the actual magnitude falls short', () => {
    // Level 10's target mean is (.70+.62+.30)/3 = 0.54 — half that
    // magnitude should score exactly 0.5.
    const result = evaluateIntensityAlignment(0.27, 10)
    expect(result.score).toBeCloseTo(0.5, 6)
  })

  it('never exceeds 1.0 for a magnitude far beyond the target', () => {
    const result = evaluateIntensityAlignment(5, 1)
    expect(result.score).toBe(1)
  })
})

describe('evaluateStyle — composite verdict', () => {
  it('passes when tone, domain, and intensity alignment all clear their thresholds', () => {
    const result = evaluateStyle(0.8, 0.8, 0.9, 0.8)
    expect(result.passed).toBe(true)
  })

  it('fails when any gating dimension fails, regardless of naturalness', () => {
    const result = evaluateStyle(0.4, 0.8, 0.99, 0.8)
    expect(result.passed).toBe(false)
  })

  it('a low naturalness score alone never fails the composite verdict', () => {
    const result = evaluateStyle(0.8, 0.8, 0.05, 0.8)
    expect(result.passed).toBe(true)
  })

  it('reports null when nothing could be evaluated at all', () => {
    const result = evaluateStyle(null, null, null, null)
    expect(result.passed).toBeNull()
  })

  it('passes through each dimension\'s raw score unchanged', () => {
    const result = evaluateStyle(0.71, 0.62, 0.55, 0.83)
    expect(result.tone_alignment).toBe(0.71)
    expect(result.domain_alignment).toBe(0.62)
    expect(result.naturalness).toBe(0.55)
    expect(result.intensity_alignment).toBe(0.83)
  })
})

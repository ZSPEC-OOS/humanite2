import { describe, it, expect } from 'vitest'
import { computeStyleTonePairMeasurements, aggregateStyleToneContrast, generateA2H11Conditions, INITIAL_STYLE_TONE_CONTRASTS } from '../a2h11'
import type { StyleToneContrast } from '../types'

const ACADEMIC_VS_CASUAL = INITIAL_STYLE_TONE_CONTRASTS[0]!

describe('generateA2H11Conditions', () => {
  it('produces exactly 2 conditions (left/right) per source per contrast', () => {
    const conditions = generateA2H11Conditions(['src-1', 'src-2'], INITIAL_STYLE_TONE_CONTRASTS)
    expect(conditions).toHaveLength(2 * INITIAL_STYLE_TONE_CONTRASTS.length * 2)
    const src1Academic = conditions.filter(c => c.sourceId === 'src-1' && c.contrastId === 'academic-vs-casual')
    expect(src1Academic.map(c => c.side).sort()).toEqual(['left', 'right'])
  })
})

describe('computeStyleTonePairMeasurements — deterministic, no LLM', () => {
  it('detects contraction rate rising from academic to casual', () => {
    const academicText = 'It is important to note that the results indicate a significant effect. The evidence suggests a clear pattern.'
    const casualText = "It's clear that the results show a big effect. You'll see it's a clear pattern, and it doesn't take much to notice."
    const measurements = computeStyleTonePairMeasurements('src-1', 'academic-vs-casual', academicText, casualText, ACADEMIC_VS_CASUAL)
    expect(measurements.contractionRate.right).toBeGreaterThan(measurements.contractionRate.left ?? 0)
    expect(measurements.contractionRate.movedExpectedDirection).toBe(true)
  })

  it('marks a metric as null (not fabricated) when either side has no measurable value', () => {
    const measurements = computeStyleTonePairMeasurements('src-1', 'academic-vs-casual', '', '', ACADEMIC_VS_CASUAL)
    expect(measurements.readability.left).toBeNull()
    expect(measurements.readability.movedExpectedDirection).toBeNull()
  })

  it('marks movedExpectedDirection null for a metric the contrast has no expected direction for', () => {
    const contrastWithNoFirstPersonExpectation: StyleToneContrast = { ...ACADEMIC_VS_CASUAL, expectedDirections: {} }
    const measurements = computeStyleTonePairMeasurements('src-1', 'academic-vs-casual', 'I think this is true.', 'We believe this holds.', contrastWithNoFirstPersonExpectation)
    expect(measurements.firstPersonRate.movedExpectedDirection).toBeNull()
    expect(measurements.firstPersonRate.delta).not.toBeNull()
  })
})

describe('aggregateStyleToneContrast', () => {
  it('computes the percentage of pairs moving the expected direction', () => {
    const pairs = [
      computeStyleTonePairMeasurements('src-1', 'academic-vs-casual', 'The evidence suggests this is true.', "It's clearly true.", ACADEMIC_VS_CASUAL),
      computeStyleTonePairMeasurements('src-2', 'academic-vs-casual', 'One must not use contractions here.', 'One must not use contractions here.', ACADEMIC_VS_CASUAL),
    ]
    const agg = aggregateStyleToneContrast(pairs, ACADEMIC_VS_CASUAL)
    expect(agg.n).toBe(2)
    expect(agg.contractionRate.pctMovedExpectedDirection).not.toBeNull()
  })

  it('reports n=0 and null stats for an empty pair list', () => {
    const agg = aggregateStyleToneContrast([], ACADEMIC_VS_CASUAL)
    expect(agg.n).toBe(0)
    expect(agg.contractionRate.meanDelta).toBeNull()
    expect(agg.contractionRate.pctMovedExpectedDirection).toBeNull()
  })
})

describe('INITIAL_STYLE_TONE_CONTRASTS — real, supported tone values only', () => {
  const REAL_TONES = new Set(['balanced', 'formal', 'casual', 'academic', 'professional'])
  it('every contrast uses only real Tone values', () => {
    for (const contrast of INITIAL_STYLE_TONE_CONTRASTS) {
      expect(REAL_TONES.has(contrast.left.tone)).toBe(true)
      expect(REAL_TONES.has(contrast.right.tone)).toBe(true)
    }
  })
})

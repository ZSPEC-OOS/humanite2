import { describe, it, expect } from 'vitest'
import { computeStyleTonePairMeasurements, aggregateStyleToneContrast, generateA2H11Conditions, INITIAL_STYLE_TONE_CONTRASTS } from '../../src/scoring/a2h11'
import type { StyleToneContrast } from '../../src/shared/types'

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

import { planA2H11Trial, measureA2H11Trial, a2h11TrialCondition, validateStyleToneContrasts, buildA2H11Report, type A2H11TrialInput } from '../../src/scoring/a2h11'
import type { TargetCallResult } from '../../src/shared/targetCalls'

const res = (output: string): TargetCallResult => ({ output, latencyMs: null, modelCalls: null, inputTokens: null, outputTokens: null, retryCount: 0 })
const input: A2H11TrialInput = { sourceId: 's1', sourceText: 'Source text.', domain: 'medical', contrast: ACADEMIC_VS_CASUAL }

describe('planA2H11Trial', () => {
  it('plans two humanize calls, intensity 5, differing only in tone, no genre/audience', () => {
    const calls = planA2H11Trial(input)
    expect(calls).toEqual([
      { operation: 'humanize', text: 'Source text.', settings: { intensity: 5, tone: 'academic', domain: 'medical' } },
      { operation: 'humanize', text: 'Source text.', settings: { intensity: 5, tone: 'casual', domain: 'medical' } },
    ])
  })
  it('records requested vs applied intensity per the domain cap', () => {
    const c = a2h11TrialCondition(input, 'right')
    expect(c).toMatchObject({ side: 'right', tone: 'casual', intensity: 5, requestedIntensity: 5 })
    expect(c.appliedIntensity).toBeLessThanOrEqual(5)
    expect(c.intensityCapped).toBe(c.appliedIntensity < 5)
  })
})

describe('measureA2H11Trial direction rules', () => {
  const academic = 'It is important to note that the results indicate a significant effect. The evidence suggests a clear pattern.'
  const casual = "It's clear that the results show a big effect. You'll see it's a clear pattern, and it doesn't take much to notice."
  it('matches computeStyleTonePairMeasurements on the same texts', () => {
    expect(measureA2H11Trial(input, [res(academic), res(casual)])).toEqual(
      computeStyleTonePairMeasurements('s1', 'academic-vs-casual', academic, casual, ACADEMIC_VS_CASUAL))
  })
  it('higher_right: contraction rate moved as expected only when right is higher', () => {
    expect(measureA2H11Trial(input, [res(academic), res(casual)]).contractionRate.movedExpectedDirection).toBe(true)
    expect(measureA2H11Trial(input, [res(casual), res(academic)]).contractionRate.movedExpectedDirection).toBe(false)
  })
  it('higher_left: sentence length moved as expected only when left is longer', () => {
    const long = 'This single sentence runs on for quite a number of words without any stop at all.'
    const short = 'Short one. Very short.'
    expect(measureA2H11Trial(input, [res(long), res(short)]).averageSentenceLength.movedExpectedDirection).toBe(true)
    expect(measureA2H11Trial(input, [res(short), res(long)]).averageSentenceLength.movedExpectedDirection).toBe(false)
  })
  it('ties are not a move in either direction', () => {
    expect(measureA2H11Trial(input, [res(academic), res(academic)]).contractionRate.movedExpectedDirection).toBe(false)
  })
  it('rejects a wrong number of results', () => {
    expect(() => measureA2H11Trial(input, [res('a')])).toThrow()
  })
})

describe('validateStyleToneContrasts / buildA2H11Report', () => {
  it('accepts the initial contrasts', () => {
    const v = validateStyleToneContrasts(INITIAL_STYLE_TONE_CONTRASTS)
    expect('contrasts' in v && v.contrasts).toEqual(INITIAL_STYLE_TONE_CONTRASTS)
  })
  it('rejects unknown tones, bad directions, duplicate ids', () => {
    const bad = (c: unknown) => 'error' in validateStyleToneContrasts(c)
    expect(bad([{ id: 'a', left: { tone: 'pirate' }, right: { tone: 'casual' } }])).toBe(true)
    expect(bad([{ id: 'a', left: { tone: 'formal' }, right: { tone: 'casual' }, expectedDirections: { readability: 'up' } }])).toBe(true)
    expect(bad([{ id: 'a', left: { tone: 'formal' }, right: { tone: 'casual' }, expectedDirections: { nonsense: 'higher_left' } }])).toBe(true)
    const ok = { id: 'a', left: { tone: 'formal' }, right: { tone: 'casual' } }
    expect(bad([ok, ok])).toBe(true)
    expect(bad([])).toBe(true)
  })
  it('builds a per-contrast report', () => {
    const pair = measureA2H11Trial(input, [res('The evidence suggests this.'), res("It's clear.")])
    const report = buildA2H11Report([pair], INITIAL_STYLE_TONE_CONTRASTS)
    expect(report.contrasts.find(c => c.contrastId === 'academic-vs-casual')!.n).toBe(1)
    expect(report.contrasts.find(c => c.contrastId === 'formal-vs-casual')!.n).toBe(0)
  })
})

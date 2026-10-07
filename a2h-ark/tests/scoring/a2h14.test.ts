import { describe, it, expect } from 'vitest'
import { computeGenreAudiencePairMeasurements, aggregateGenreAudienceContrast, generateA2H14Conditions, INITIAL_GENRE_AUDIENCE_CONTRASTS } from '../../src/scoring/a2h14'

const PATIENT_VS_RESEARCH = INITIAL_GENRE_AUDIENCE_CONTRASTS[0]!

describe('generateA2H14Conditions', () => {
  it('produces exactly 2 conditions (left/right) per source per contrast', () => {
    const conditions = generateA2H14Conditions(['src-1'], INITIAL_GENRE_AUDIENCE_CONTRASTS)
    expect(conditions).toHaveLength(INITIAL_GENRE_AUDIENCE_CONTRASTS.length * 2)
  })
})

describe('computeGenreAudiencePairMeasurements — deterministic, no subjective genre classifier', () => {
  it('detects patient instructions reading easier (higher Flesch) than a dense research paper', () => {
    const patientText = 'Take this pill once a day. Drink water with it. Call your doctor if you feel sick.'
    const researchText = 'The pharmacokinetic profile of the administered compound demonstrated statistically significant heterogeneity across the sampled cohort, necessitating further multivariate investigation of confounding covariates.'
    const measurements = computeGenreAudiencePairMeasurements('src-1', PATIENT_VS_RESEARCH.id, patientText, researchText, PATIENT_VS_RESEARCH)
    expect(measurements.readability.left).toBeGreaterThan(measurements.readability.right ?? -Infinity)
    expect(measurements.readability.movedExpectedDirection).toBe(true)
  })

  it('computes paragraph length as words-per-paragraph, null when a side has zero paragraphs', () => {
    const measurements = computeGenreAudiencePairMeasurements('src-1', PATIENT_VS_RESEARCH.id, 'One paragraph only, four words.', '', PATIENT_VS_RESEARCH)
    expect(measurements.paragraphLength.left).not.toBeNull()
    expect(measurements.paragraphLength.right).toBeNull()
  })
})

describe('aggregateGenreAudienceContrast', () => {
  it('reports n=0 and null stats for an empty pair list', () => {
    const agg = aggregateGenreAudienceContrast([], PATIENT_VS_RESEARCH)
    expect(agg.n).toBe(0)
    expect(agg.readability.meanDelta).toBeNull()
  })

  it('aggregates across multiple pairs', () => {
    const pairs = [
      computeGenreAudiencePairMeasurements('src-1', PATIENT_VS_RESEARCH.id, 'Take this pill once a day.', 'The compound exhibited heterogeneous pharmacokinetics.', PATIENT_VS_RESEARCH),
      computeGenreAudiencePairMeasurements('src-2', PATIENT_VS_RESEARCH.id, 'Drink water daily.', 'Longitudinal analysis revealed significant covariate interactions.', PATIENT_VS_RESEARCH),
    ]
    const agg = aggregateGenreAudienceContrast(pairs, PATIENT_VS_RESEARCH)
    expect(agg.n).toBe(2)
    expect(agg.readability.pctMovedExpectedDirection).not.toBeNull()
  })
})

describe('INITIAL_GENRE_AUDIENCE_CONTRASTS — real, supported genre/audience values only', () => {
  const REAL_GENRES = new Set(['essay', 'research_paper', 'report', 'email', 'proposal', 'blog', 'documentation', 'clinical_note', 'patient_instructions', 'contract', 'memo'])
  const REAL_AUDIENCES = new Set(['general', 'expert', 'executive', 'academic', 'customer', 'patient', 'regulatory'])
  it('every contrast uses only real Genre/Audience values', () => {
    for (const contrast of INITIAL_GENRE_AUDIENCE_CONTRASTS) {
      if (contrast.left.genre) expect(REAL_GENRES.has(contrast.left.genre)).toBe(true)
      if (contrast.right.genre) expect(REAL_GENRES.has(contrast.right.genre)).toBe(true)
      if (contrast.left.audience) expect(REAL_AUDIENCES.has(contrast.left.audience)).toBe(true)
      if (contrast.right.audience) expect(REAL_AUDIENCES.has(contrast.right.audience)).toBe(true)
    }
  })
})

import { planA2H14Trial, measureA2H14Trial, a2h14TrialCondition, validateGenreAudienceContrasts, buildA2H14Report, type A2H14TrialInput } from '../../src/scoring/a2h14'
import type { TargetCallResult } from '../../src/shared/targetCalls'

const res = (output: string): TargetCallResult => ({ output, latencyMs: null, modelCalls: null, inputTokens: null, outputTokens: null, retryCount: 0 })
const EXEC = INITIAL_GENRE_AUDIENCE_CONTRASTS[1]!
const pi: A2H14TrialInput = { sourceId: 's1', sourceText: 'Source.', sourceDomain: 'business', contrast: PATIENT_VS_RESEARCH }
const ex: A2H14TrialInput = { sourceId: 's1', sourceText: 'Source.', sourceDomain: 'business', contrast: EXEC }

describe('planA2H14Trial', () => {
  it('uses the contrast domain, balanced tone, intensity 5, genre per side', () => {
    expect(planA2H14Trial(pi)).toEqual([
      { operation: 'humanize', text: 'Source.', settings: { intensity: 5, tone: 'balanced', domain: 'medical', genre: 'patient_instructions', audience: null } },
      { operation: 'humanize', text: 'Source.', settings: { intensity: 5, tone: 'balanced', domain: 'medical', genre: 'research_paper', audience: null } },
    ])
  })
  it('falls back to the source domain and varies audience', () => {
    const calls = planA2H14Trial(ex)
    expect(calls.map(c => c.settings)).toEqual([
      { intensity: 5, tone: 'balanced', domain: 'business', genre: null, audience: 'executive' },
      { intensity: 5, tone: 'balanced', domain: 'business', genre: null, audience: 'general' },
    ])
  })
  it('records the effective intensity condition', () => {
    const c = a2h14TrialCondition(pi, 'left')
    expect(c).toMatchObject({ domain: 'medical', genre: 'patient_instructions', audience: null, requestedIntensity: 5 })
  })
})

describe('measureA2H14Trial direction rules', () => {
  const easy = 'Take this pill once a day. Drink water with it. Call your doctor if you feel sick.'
  const dense = 'The pharmacokinetic profile of the administered compound demonstrated statistically significant heterogeneity across the sampled cohort, necessitating further multivariate investigation of confounding covariates.'
  it('matches computeGenreAudiencePairMeasurements', () => {
    expect(measureA2H14Trial(pi, [res(easy), res(dense)])).toEqual(computeGenreAudiencePairMeasurements('s1', PATIENT_VS_RESEARCH.id, easy, dense, PATIENT_VS_RESEARCH))
  })
  it('readability higher_left / sentence length higher_right, flipped when swapped', () => {
    const fwd = measureA2H14Trial(pi, [res(easy), res(dense)])
    expect(fwd.readability.movedExpectedDirection).toBe(true)
    expect(fwd.averageSentenceLength.movedExpectedDirection).toBe(true)
    const rev = measureA2H14Trial(pi, [res(dense), res(easy)])
    expect(rev.readability.movedExpectedDirection).toBe(false)
    expect(rev.averageSentenceLength.movedExpectedDirection).toBe(false)
  })
  it('paragraph length higher_right is words per paragraph', () => {
    const oneLong = 'one two three four five six seven eight nine ten.'
    const twoShort = 'one two.\n\nthree four.'
    expect(measureA2H14Trial(ex, [res(twoShort), res(oneLong)]).paragraphLength.movedExpectedDirection).toBe(true)
    expect(measureA2H14Trial(ex, [res(oneLong), res(twoShort)]).paragraphLength.movedExpectedDirection).toBe(false)
  })
  it('lexical complexity has no expected direction for the executive contrast', () => {
    expect(measureA2H14Trial(ex, [res(easy), res(dense)]).lexicalComplexity.movedExpectedDirection).toBeNull()
  })
  it('rejects a wrong number of results', () => {
    expect(() => measureA2H14Trial(pi, [])).toThrow()
  })
})

describe('validateGenreAudienceContrasts / buildA2H14Report', () => {
  it('accepts the initial contrasts', () => {
    const v = validateGenreAudienceContrasts(INITIAL_GENRE_AUDIENCE_CONTRASTS)
    expect('contrasts' in v).toBe(true)
  })
  it('rejects bad genre, audience, domain, empty sides and bad directions', () => {
    const bad = (c: unknown) => 'error' in validateGenreAudienceContrasts(c)
    const side = { genre: 'essay' }
    expect(bad([{ id: 'a', left: { genre: 'haiku' }, right: side }])).toBe(true)
    expect(bad([{ id: 'a', left: { audience: 'aliens' }, right: side }])).toBe(true)
    expect(bad([{ id: 'a', domain: 'space', left: side, right: side }])).toBe(true)
    expect(bad([{ id: 'a', left: {}, right: side }])).toBe(true)
    expect(bad([{ id: 'a', left: side, right: side, expectedDirections: { readability: 'sideways' } }])).toBe(true)
    expect(bad([{ id: 'a', left: side, right: { genre: 'memo' } }])).toBe(false)
  })
  it('builds a per-contrast report', () => {
    const pair = measureA2H14Trial(pi, [res('Take this pill.'), res('The compound exhibited heterogeneity.')])
    const r = buildA2H14Report([pair], INITIAL_GENRE_AUDIENCE_CONTRASTS)
    expect(r.contrasts.map(c => c.n)).toEqual([1, 0])
  })
})

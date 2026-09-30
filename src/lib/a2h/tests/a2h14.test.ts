import { describe, it, expect } from 'vitest'
import { computeGenreAudiencePairMeasurements, aggregateGenreAudienceContrast, generateA2H14Conditions, INITIAL_GENRE_AUDIENCE_CONTRASTS } from '../a2h14'

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

import { describe, it, expect } from 'vitest'
import { computeA2H13Measurements, validateTerminologyFixtureExpected, type TerminologyFixtureExpected } from '../a2h13'
import type { BenchmarkFixture } from '../types'

let ordinal = 0
function fixture(partial: Partial<TerminologyFixtureExpected> & { preferredTerm: string }): BenchmarkFixture {
  const expected: TerminologyFixtureExpected = { allowedVariants: [], forbiddenVariants: [], caseSensitive: false, expectedMinimumOccurrences: null, ...partial }
  return {
    id: `fx-${++ordinal}`, fixtureSetId: 'set-1', corpusProjectId: 'proj-1', sourceId: 'src-1',
    type: 'terminology', ordinal, expected: expected as unknown as Record<string, unknown>,
    sourceStart: null, sourceEnd: null, sourceText: null, notes: null, corruptionGeneratorVersion: null,
    createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z',
  }
}

describe('computeA2H13Measurements — §44 acceptance cases', () => {
  it('preferred term used consistently', () => {
    const m = computeA2H13Measurements(
      [fixture({ preferredTerm: 'myocardial infarction' })],
      'The patient suffered a myocardial infarction. The myocardial infarction was severe.',
    )
    expect(m.consistencyRate).toBe(1)
    expect(m.preferredCount).toBe(2)
  })

  it('allowed abbreviation counted as consistent', () => {
    const m = computeA2H13Measurements(
      [fixture({ preferredTerm: 'myocardial infarction', allowedVariants: ['MI'] })],
      'The patient suffered a myocardial infarction. The MI was severe.',
    )
    expect(m.consistencyRate).toBe(1)
    expect(m.allowedVariantCount).toBe(1)
  })

  it('forbidden synonym detected', () => {
    const m = computeA2H13Measurements(
      [fixture({ preferredTerm: 'myocardial infarction', forbiddenVariants: ['heart episode'] })],
      'The patient suffered a myocardial infarction. Later, a heart episode occurred.',
    )
    expect(m.forbiddenVariantCount).toBe(1)
    expect(m.consistencyRate).toBeLessThan(1)
  })

  it('unexpected variant detected (case mismatch under caseSensitive fixture)', () => {
    const m = computeA2H13Measurements(
      [fixture({ preferredTerm: 'myocardial infarction', caseSensitive: true })],
      'The patient suffered a Myocardial Infarction.',
    )
    expect(m.unexpectedVariantCount).toBe(1)
    expect(m.preferredCount).toBe(0)
  })

  it('mixed preferred + allowed variant passes (fully consistent)', () => {
    const m = computeA2H13Measurements(
      [fixture({ preferredTerm: 'myocardial infarction', allowedVariants: ['MI'] })],
      'A myocardial infarction was noted. The MI recurred twice: MI again and MI once more.',
    )
    expect(m.consistencyRate).toBe(1)
    expect(m.forbiddenVariantCount).toBe(0)
    expect(m.unexpectedVariantCount).toBe(0)
  })

  it('no controlled occurrence -> eligible true but consistencyRate null', () => {
    const m = computeA2H13Measurements([fixture({ preferredTerm: 'myocardial infarction' })], 'This text never mentions the condition at all.')
    expect(m.eligible).toBe(true)
    expect(m.controlledOccurrenceCount).toBe(0)
    expect(m.consistencyRate).toBeNull()
  })

  it('multiple terminology fixtures in one source aggregate together', () => {
    const m = computeA2H13Measurements(
      [fixture({ preferredTerm: 'myocardial infarction' }), fixture({ preferredTerm: 'hypertension', forbiddenVariants: ['high blood pressure'] })],
      'The myocardial infarction was treated. The patient also has hypertension, not high blood pressure.',
    )
    expect(m.fixtureCount).toBe(2)
    expect(m.preferredCount).toBe(2)
    expect(m.forbiddenVariantCount).toBe(1)
    expect(m.terminology).toHaveLength(2)
  })
})

describe('computeA2H13Measurements aggregate behavior', () => {
  it('is ineligible with zero terminology fixtures', () => {
    const m = computeA2H13Measurements([], 'irrelevant')
    expect(m.eligible).toBe(false)
    expect(m.consistencyRate).toBeNull()
  })
})

describe('validateTerminologyFixtureExpected', () => {
  it('accepts a well-formed fixture', () => {
    expect(validateTerminologyFixtureExpected({ preferredTerm: 'myocardial infarction', allowedVariants: ['MI'], forbiddenVariants: [], caseSensitive: false })).toEqual([])
  })

  it('rejects overlap between allowedVariants and forbiddenVariants', () => {
    const errors = validateTerminologyFixtureExpected({
      preferredTerm: 'myocardial infarction', allowedVariants: ['MI'], forbiddenVariants: ['mi'], caseSensitive: false,
    })
    expect(errors.length).toBeGreaterThan(0)
  })

  it('rejects a missing preferredTerm', () => {
    expect(validateTerminologyFixtureExpected({ preferredTerm: '', caseSensitive: false }).length).toBeGreaterThan(0)
  })
})

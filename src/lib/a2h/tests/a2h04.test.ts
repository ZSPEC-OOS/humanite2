import { describe, it, expect } from 'vitest'
import { computeA2H04Measurements, validateCitationFixtureExpected, extractCitationCandidates, type CitationFixtureExpected } from '../a2h04'
import { normalizeCitation } from '../citationNormalize'
import type { BenchmarkFixture } from '../types'

let ordinal = 0
function fixture(expected: CitationFixtureExpected): BenchmarkFixture {
  return {
    id: `fx-${++ordinal}`, fixtureSetId: 'set-1', corpusProjectId: 'proj-1', sourceId: 'src-1',
    type: 'citation', ordinal, expected: expected as unknown as Record<string, unknown>,
    sourceStart: null, sourceEnd: null, sourceText: null, notes: null, corruptionGeneratorVersion: null,
    createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z',
  }
}

describe('citationNormalize', () => {
  it('normalizes bracket citation whitespace without changing the number', () => {
    expect(normalizeCitation('numeric', '[ 1 ]')).toBe('[1]')
    expect(normalizeCitation('numeric_range', '[ 4 - 7 ]')).toBe('[4-7]')
  })

  it('never changes a meaningful citation number', () => {
    expect(normalizeCitation('numeric_range', '[4-7]')).not.toBe(normalizeCitation('numeric_range', '[4-8]'))
    expect(normalizeCitation('figure', 'Figure 3')).not.toBe(normalizeCitation('figure', 'Figure 4'))
  })

  it('strips leading zeros from figure/table/section numbers', () => {
    expect(normalizeCitation('figure', 'Figure 03')).toBe('Figure 3')
    expect(normalizeCitation('section', 'Section 04.01')).toBe('Section 4.1')
  })

  it('strips known DOI prefixes and lowercases', () => {
    expect(normalizeCitation('doi', 'https://doi.org/10.1038/S41586-024-XXXXX')).toBe('10.1038/s41586-024-xxxxx')
    expect(normalizeCitation('doi', 'doi:10.1038/s41586-024-xxxxx')).toBe('10.1038/s41586-024-xxxxx')
  })
})

describe('computeA2H04Measurements', () => {
  it('is ineligible when the source has no citation fixtures', () => {
    const m = computeA2H04Measurements([], 'no citations here')
    expect(m.eligible).toBe(false)
    expect(m.fixtureCount).toBe(0)
    expect(m.preservationRate).toBeNull()
  })

  it('classifies an exact numeric citation as preserved', () => {
    const f = fixture({ kind: 'numeric', exactText: '[1]', normalizedText: '[1]' })
    const m = computeA2H04Measurements([f], 'Some claim [1] follows.')
    expect(m.eligible).toBe(true)
    expect(m.preservedCount).toBe(1)
    expect(m.preservationRate).toBe(1)
  })

  it('classifies a fully dropped citation as missing', () => {
    const f = fixture({ kind: 'numeric', exactText: '[1]', normalizedText: '[1]' })
    const m = computeA2H04Measurements([f], 'Some claim follows with no citation.')
    expect(m.missingCount).toBe(1)
    expect(m.preservationRate).toBe(0)
  })

  it('classifies a repeated exact citation as duplicated', () => {
    const f = fixture({ kind: 'numeric', exactText: '[1]', normalizedText: '[1]' })
    const m = computeA2H04Measurements([f], 'Claim [1]. Repeated claim [1] again.')
    expect(m.duplicatedCount).toBe(1)
    expect(m.preservedCount).toBe(0)
  })

  it('classifies a changed citation number as modified', () => {
    const f = fixture({ kind: 'numeric', exactText: '[1]', normalizedText: '[1]' })
    const m = computeA2H04Measurements([f], 'Claim [2] follows.')
    expect(m.modifiedCount).toBe(1)
    expect(m.fixtures[0]!.observed).toEqual(['[2]'])
  })

  it('classifies a modified numeric range', () => {
    const f = fixture({ kind: 'numeric_range', exactText: '[4-7]', normalizedText: '[4-7]' })
    const m = computeA2H04Measurements([f], 'See [4-8] for details.')
    expect(m.modifiedCount).toBe(1)
  })

  it('classifies an exact author-year citation as preserved', () => {
    const f = fixture({ kind: 'author_year', exactText: '(Smith, 2024)', normalizedText: '(Smith, 2024)' })
    const m = computeA2H04Measurements([f], 'As shown (Smith, 2024), the effect holds.')
    expect(m.preservedCount).toBe(1)
  })

  it('classifies an author-year citation with a changed year as modified', () => {
    const f = fixture({ kind: 'author_year', exactText: '(Smith, 2024)', normalizedText: '(Smith, 2024)' })
    const m = computeA2H04Measurements([f], 'As shown (Smith, 2025), the effect holds.')
    expect(m.modifiedCount).toBe(1)
  })

  it('preserves a DOI with a normalized URL prefix difference', () => {
    const f = fixture({ kind: 'doi', exactText: '10.1038/s41586-024-xxxxx', normalizedText: normalizeCitation('doi', '10.1038/s41586-024-xxxxx') })
    const m = computeA2H04Measurements([f], 'See https://doi.org/10.1038/s41586-024-xxxxx for the dataset.')
    expect(m.preservedCount).toBe(1)
  })

  it('classifies a changed DOI as modified', () => {
    const f = fixture({ kind: 'doi', exactText: '10.1038/s41586-024-xxxxx', normalizedText: normalizeCitation('doi', '10.1038/s41586-024-xxxxx') })
    const m = computeA2H04Measurements([f], 'See doi:10.1038/s41586-024-yyyyy instead.')
    expect(m.modifiedCount).toBe(1)
  })

  it('classifies a changed figure number as modified', () => {
    const f = fixture({ kind: 'figure', exactText: 'Figure 3', normalizedText: 'Figure 3' })
    const m = computeA2H04Measurements([f], 'As seen in Figure 4.')
    expect(m.modifiedCount).toBe(1)
  })

  it('classifies a changed section number as modified', () => {
    const f = fixture({ kind: 'section', exactText: 'Section 4.1', normalizedText: 'Section 4.1' })
    const m = computeA2H04Measurements([f], 'Discussed in Section 4.2.')
    expect(m.modifiedCount).toBe(1)
  })

  it('detects an unexpected new citation not in the fixture set', () => {
    const f = fixture({ kind: 'numeric', exactText: '[1]', normalizedText: '[1]' })
    const m = computeA2H04Measurements([f], 'Claim [1] and a new claim [2].')
    expect(m.preservedCount).toBe(1)
    expect(m.unexpectedCount).toBe(1)
  })

  it('keeps kinds independent — a table fixture is never satisfied by a figure token', () => {
    const f = fixture({ kind: 'table', exactText: 'Table 2', normalizedText: 'Table 2' })
    const m = computeA2H04Measurements([f], 'See Figure 2 for the chart.')
    expect(m.missingCount).toBe(1)
    expect(m.unexpectedCount).toBe(1) // the figure token is unexpected under 'figure' kind
  })
})

describe('validateCitationFixtureExpected', () => {
  it('accepts a well-formed fixture', () => {
    expect(validateCitationFixtureExpected({ kind: 'numeric', exactText: '[1]', normalizedText: '[1]' })).toEqual([])
  })

  it('rejects an invalid kind', () => {
    expect(validateCitationFixtureExpected({ kind: 'bogus', exactText: '[1]', normalizedText: '[1]' }).length).toBeGreaterThan(0)
  })

  it('rejects a normalizedText that disagrees with the deterministic normalization', () => {
    expect(validateCitationFixtureExpected({ kind: 'numeric', exactText: '[ 1 ]', normalizedText: '[2]' }).length).toBeGreaterThan(0)
  })
})

describe('extractCitationCandidates', () => {
  it('proposes one candidate per distinct citation found in source text', () => {
    const candidates = extractCitationCandidates('Claim one [1]. Claim two [1] again. See Figure 3 and Table 2.')
    expect(candidates).toHaveLength(3)
    expect(candidates.map(c => c.kind).sort()).toEqual(['figure', 'numeric', 'table'])
  })
})

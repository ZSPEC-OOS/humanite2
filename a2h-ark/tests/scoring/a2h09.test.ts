import { describe, it, expect } from 'vitest'
import { computeA2H09Measurements, validateModalityFixtureExpected, extractModalityCandidates, type ModalityFixtureExpected, type ModalityCategory } from '../../src/scoring/a2h09'
import type { BenchmarkFixture } from '../../src/shared/types'

let ordinal = 0
function fixture(partial: Partial<ModalityFixtureExpected> & { exactText: string; category: ModalityCategory; strength: number }): BenchmarkFixture {
  const expected: ModalityFixtureExpected = { approvedEquivalentForms: [], anchorText: null, ...partial }
  return {
    id: `fx-${++ordinal}`, fixtureSetId: 'set-1', corpusProjectId: 'proj-1', sourceId: 'src-1',
    type: 'modality', ordinal, expected: expected as unknown as Record<string, unknown>,
    sourceStart: null, sourceEnd: null, sourceText: null, notes: null, corruptionGeneratorVersion: null,
    createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z',
  }
}

function classify(partial: Parameters<typeof fixture>[0], outputText: string) {
  const m = computeA2H09Measurements([fixture(partial)], outputText)
  return m.fixtures[0]!.status
}

describe('computeA2H09Measurements — §42 acceptance cases', () => {
  it('may -> may: preserved', () => {
    const status = classify(
      { exactText: 'may', category: 'permission', strength: 2, anchorText: 'discontinue medication after 7 days' },
      'Patients may discontinue medication after 7 days.',
    )
    expect(status).toBe('preserved')
  })

  it('may -> might: preserved when configured as an approved equivalent form', () => {
    const status = classify(
      { exactText: 'may', category: 'possibility', strength: 2, approvedEquivalentForms: ['might'], anchorText: 'discontinue medication after 7 days' },
      'Patients might discontinue medication after 7 days.',
    )
    expect(status).toBe('preserved')
  })

  it('may -> must: strengthened', () => {
    const status = classify(
      { exactText: 'may', category: 'possibility', strength: 2, anchorText: 'discontinue the medication after 7 days' },
      'Patients must discontinue the medication after 7 days.',
    )
    expect(status).toBe('strengthened')
  })

  it('must -> may: weakened', () => {
    const status = classify(
      { exactText: 'must', category: 'necessity', strength: 4, anchorText: 'discontinue the medication after 7 days' },
      'Patients may discontinue the medication after 7 days.',
    )
    expect(status).toBe('weakened')
  })

  it('not -> removed: reversed', () => {
    const status = classify(
      { exactText: 'not', category: 'negation', strength: 0, anchorText: 'results' },
      'The results increased significantly.',
    )
    expect(status).toBe('reversed')
  })

  it('must not -> must: reversed', () => {
    const status = classify(
      { exactText: 'must not', category: 'prohibition', strength: 0, anchorText: 'exceed the maximum dose' },
      'Patients must exceed the maximum dose.',
    )
    expect(status).toBe('reversed')
  })

  it('should -> should: preserved', () => {
    const status = classify(
      { exactText: 'should', category: 'recommendation', strength: 3, anchorText: 'consult a physician' },
      'Patients should consult a physician.',
    )
    expect(status).toBe('preserved')
  })

  it('likely -> unlikely: reversed', () => {
    const status = classify(
      { exactText: 'likely', category: 'likelihood', strength: 2, anchorText: 'to recur within a year' },
      'The condition is unlikely to recur within a year.',
    )
    expect(status).toBe('reversed')
  })

  it('modality on an unrelated sentence does not satisfy the fixture binding (anchor not found -> missing)', () => {
    const status = classify(
      { exactText: 'may', category: 'permission', strength: 2, anchorText: 'discontinue medication after 7 days' },
      'A completely unrelated sentence about something else. Patients must comply with regulations.',
    )
    expect(status).toBe('missing')
  })
})

describe('computeA2H09Measurements aggregate behavior', () => {
  it('is ineligible with zero modality fixtures', () => {
    const m = computeA2H09Measurements([], 'irrelevant')
    expect(m.eligible).toBe(false)
    expect(m.preservationRate).toBeNull()
  })

  it('falls back to the whole output as the window when no anchorText is given', () => {
    const m = computeA2H09Measurements(
      [fixture({ exactText: 'should', category: 'recommendation', strength: 3, anchorText: null })],
      'Patients should consult a physician before use.',
    )
    expect(m.fixtures[0]!.status).toBe('preserved')
  })
})

describe('validateModalityFixtureExpected', () => {
  it('accepts a well-formed fixture', () => {
    expect(validateModalityFixtureExpected({ exactText: 'must', category: 'necessity', strength: 4, approvedEquivalentForms: [] })).toEqual([])
  })

  it('rejects an invalid category', () => {
    expect(validateModalityFixtureExpected({ exactText: 'must', category: 'bogus', strength: 4 }).length).toBeGreaterThan(0)
  })

  it('rejects duplicate approvedEquivalentForms', () => {
    expect(validateModalityFixtureExpected({ exactText: 'may', category: 'permission', strength: 2, approvedEquivalentForms: ['might', 'Might'] }).length).toBeGreaterThan(0)
  })
})

describe('extractModalityCandidates', () => {
  it('proposes a candidate per controlled-vocabulary occurrence with surrounding context', () => {
    const candidates = extractModalityCandidates('Patients may discontinue medication. Patients must not exceed the dose.')
    expect(candidates.map(c => c.exactText.toLowerCase())).toEqual(expect.arrayContaining(['may', 'must not']))
  })
})

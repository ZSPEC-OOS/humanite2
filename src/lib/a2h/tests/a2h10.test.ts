import { describe, it, expect } from 'vitest'
import { computeA2H10Measurements, validateProtectedTermFixtureExpected, extractProtectedTermCandidates, type ProtectedTermFixtureExpected } from '../a2h10'
import type { BenchmarkFixture } from '../types'

let ordinal = 0
function fixture(partial: Partial<ProtectedTermFixtureExpected> & { exactText: string }): BenchmarkFixture {
  const expected: ProtectedTermFixtureExpected = { kind: 'other_exact', caseSensitive: true, allowedVariants: [], ...partial }
  return {
    id: `fx-${++ordinal}`, fixtureSetId: 'set-1', corpusProjectId: 'proj-1', sourceId: 'src-1',
    type: 'protected_term', ordinal, expected: expected as unknown as Record<string, unknown>,
    sourceStart: null, sourceEnd: null, sourceText: null, notes: null, corruptionGeneratorVersion: null,
    createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z',
  }
}

function classify(partial: Parameters<typeof fixture>[0], outputText: string) {
  const m = computeA2H10Measurements([fixture(partial)], outputText)
  return m.fixtures[0]!.status
}

describe('computeA2H10Measurements — §43 acceptance cases', () => {
  it('exact chemical name preserved', () => {
    expect(classify({ exactText: 'N-acetylcysteine' }, 'The patient received N-acetylcysteine treatment.')).toBe('preserved')
  })

  it('hyphenated chemical altered (hyphen dropped) -> modified', () => {
    expect(classify({ exactText: 'N-acetylcysteine' }, 'The patient received N acetylcysteine treatment.')).toBe('modified')
  })

  it('acronym preserved', () => {
    expect(classify({ exactText: 'CYP2D6' }, 'The gene CYP2D6 metabolizes this drug.')).toBe('preserved')
  })

  it('acronym reformatted (not fully expanded) -> modified', () => {
    expect(classify({ exactText: 'CYP2D6' }, 'The gene CYP 2D6 metabolizes this drug.')).toBe('modified')
  })

  it('gene name preserved', () => {
    expect(classify({ exactText: 'BRCA1' }, 'Mutations in BRCA1 increase risk.')).toBe('preserved')
  })

  it('standard number changed -> missing (unrelated replacement text)', () => {
    expect(classify({ exactText: 'ISO 27001' }, 'The system follows ISO 9001 instead.')).toBe('missing')
  })

  it('software identifier changed -> missing', () => {
    expect(classify({ exactText: 'PostgreSQL' }, 'The system uses MySQL instead.')).toBe('missing')
  })

  it('duplicate protected term detected', () => {
    expect(classify({ exactText: 'BRCA1' }, 'BRCA1 is discussed here. BRCA1 is discussed again.')).toBe('duplicated')
  })

  it('case-insensitive fixture works when configured', () => {
    expect(classify({ exactText: 'PostgreSQL', caseSensitive: false }, 'The system uses postgresql for storage.')).toBe('preserved')
  })

  it('case-sensitive fixture is not silently preserved when case changes', () => {
    const status = classify({ exactText: 'PostgreSQL', caseSensitive: true }, 'The system uses postgresql for storage.')
    expect(status).not.toBe('preserved')
  })

  it('an approved allowed variant counts as preserved', () => {
    expect(classify({ exactText: 'acetylsalicylic acid', allowedVariants: ['aspirin'] }, 'The patient was given aspirin.')).toBe('preserved')
  })
})

describe('computeA2H10Measurements aggregate behavior', () => {
  it('is ineligible with zero protected_term fixtures', () => {
    const m = computeA2H10Measurements([], 'irrelevant')
    expect(m.eligible).toBe(false)
    expect(m.preservationRate).toBeNull()
  })

  it('reports a fully dropped term as missing', () => {
    const m = computeA2H10Measurements([fixture({ exactText: 'H2SO4' })], 'No chemical mentioned at all.')
    expect(m.missingCount).toBe(1)
    expect(m.preservationRate).toBe(0)
  })
})

describe('validateProtectedTermFixtureExpected', () => {
  it('accepts a well-formed fixture', () => {
    expect(validateProtectedTermFixtureExpected({ kind: 'gene', exactText: 'BRCA1', caseSensitive: true, allowedVariants: [] })).toEqual([])
  })

  it('rejects missing exactText', () => {
    expect(validateProtectedTermFixtureExpected({ kind: 'gene', exactText: '', caseSensitive: true }).length).toBeGreaterThan(0)
  })

  it('rejects duplicate allowedVariants', () => {
    expect(validateProtectedTermFixtureExpected({ kind: 'gene', exactText: 'BRCA1', caseSensitive: true, allowedVariants: ['brca-1', 'brca-1'] }).length).toBeGreaterThan(0)
  })

  it('is case-insensitive when checking for duplicate allowedVariants under a caseSensitive:false fixture', () => {
    expect(validateProtectedTermFixtureExpected({ kind: 'gene', exactText: 'BRCA1', caseSensitive: false, allowedVariants: ['brca-1', 'BRCA-1'] }).length).toBeGreaterThan(0)
  })
})

describe('extractProtectedTermCandidates', () => {
  it('proposes acronym/gene and standard-code candidates', () => {
    const candidates = extractProtectedTermCandidates('The gene CYP2D6 interacts with ISO 27001 compliance and CAS 64-17-5.')
    const texts = candidates.map(c => c.exactText)
    expect(texts).toContain('CYP2D6')
    expect(texts.some(t => t.includes('27001'))).toBe(true)
  })
})

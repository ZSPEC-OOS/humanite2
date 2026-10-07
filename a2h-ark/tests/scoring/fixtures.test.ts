import { describe, it, expect } from 'vitest'
import {
  buildFixtureSet, buildFixture, applyFixtureUpdate, validateFixtureSet, lockFixtureSet,
  fixturesForSource, fixturesBySource, scanSourceForCandidates, validateExpectedShape, FIXTURE_TYPE_FOR_TEST,
  type FixtureSetValidationInput,
} from '../../src/scoring/fixtures'
import { DETERMINISTIC_EVALUATORS, isDeterministicTest } from '../../src/scoring/deterministicEvaluators'
import type { BenchmarkFixture, FixtureSet } from '../../src/shared/types'

const NOW = '2026-01-01T00:00:00.000Z'
const CITATION_EXPECTED = { kind: 'numeric', exactText: '[1]', normalizedText: '[1]' }

function set(overrides: Partial<FixtureSet> = {}): FixtureSet {
  return { id: 's1', corpusProjectId: 'p1', name: 'F', fixtureVersion: 'FIXTURE-V001', status: 'draft', createdAt: NOW, updatedAt: NOW, lockedAt: null, ...overrides }
}
const frozenSource = { corpusProjectId: 'p1', status: 'frozen' as const }

describe('buildFixtureSet / versioning', () => {
  it('assigns FIXTURE-V001 first, then V002', () => {
    const v1 = buildFixtureSet({ corpusProjectId: 'p1', name: ' Fixtures ' }, { id: 'p1' }, [], 'a', NOW)
    expect(v1.fixtureVersion).toBe('FIXTURE-V001')
    expect(v1.status).toBe('draft')
    expect(v1.name).toBe('Fixtures')
    const v2 = buildFixtureSet({ corpusProjectId: 'p1', name: 'V2' }, { id: 'p1' }, [v1], 'b', NOW)
    expect(v2.fixtureVersion).toBe('FIXTURE-V002')
  })
  it('throws for a missing project or empty name', () => {
    expect(() => buildFixtureSet({ corpusProjectId: 'p1', name: 'X' }, null, [], 'a', NOW)).toThrow(/not found/i)
    expect(() => buildFixtureSet({ corpusProjectId: 'p1', name: ' ' }, { id: 'p1' }, [], 'a', NOW)).toThrow(/name is required/)
  })
})

describe('buildFixture', () => {
  it('auto-assigns ordinals per source/type', () => {
    const f0 = buildFixture({ fixtureSetId: 's1', sourceId: 'src', type: 'citation', expected: CITATION_EXPECTED }, set(), frozenSource, [], 'f0', NOW)
    expect(f0.ordinal).toBe(0)
    expect(f0.corpusProjectId).toBe('p1')
    const f1 = buildFixture({ fixtureSetId: 's1', sourceId: 'src', type: 'citation', expected: { ...CITATION_EXPECTED, exactText: '[2]', normalizedText: '[2]' } }, set(), frozenSource, [f0], 'f1', NOW)
    expect(f1.ordinal).toBe(1)
  })
  it('rejects unfrozen sources, foreign-project sources, locked sets, bad shapes and duplicate ordinals', () => {
    const input = { fixtureSetId: 's1', sourceId: 'src', type: 'citation' as const, expected: CITATION_EXPECTED }
    expect(() => buildFixture(input, set(), { corpusProjectId: 'p1', status: 'validated' }, [], 'f', NOW)).toThrow(/frozen/)
    expect(() => buildFixture(input, set(), { corpusProjectId: 'other', status: 'frozen' }, [], 'f', NOW)).toThrow(/does not belong/)
    expect(() => buildFixture(input, set({ status: 'locked' }), frozenSource, [], 'f', NOW)).toThrow(/locked/)
    expect(() => buildFixture(input, null, frozenSource, [], 'f', NOW)).toThrow(/not found/)
    expect(() => buildFixture(input, set(), null, [], 'f', NOW)).toThrow(/Source not found/)
    expect(() => buildFixture({ ...input, expected: { kind: 'numeric', exactText: '[1]', normalizedText: 'wrong' } }, set(), frozenSource, [], 'f', NOW)).toThrow(/Invalid fixture/)
    const f0 = buildFixture({ ...input, ordinal: 3 }, set(), frozenSource, [], 'f0', NOW)
    expect(() => buildFixture({ ...input, ordinal: 3 }, set(), frozenSource, [f0], 'f1', NOW)).toThrow(/Ordinal 3/)
  })
  it('applyFixtureUpdate validates the new expected shape and respects mutability', () => {
    const f = buildFixture({ fixtureSetId: 's1', sourceId: 'src', type: 'citation', expected: CITATION_EXPECTED }, set(), frozenSource, [], 'f0', NOW)
    expect(applyFixtureUpdate(f, set(), { notes: 'n' }, 'later').notes).toBe('n')
    expect(() => applyFixtureUpdate(f, set(), { expected: {} }, NOW)).toThrow(/Invalid fixture/)
    expect(() => applyFixtureUpdate(f, set({ status: 'archived' }), { notes: 'n' }, NOW)).toThrow(/archived/)
    expect(() => applyFixtureUpdate(null, set(), {}, NOW)).toThrow(/not found/)
  })
})

describe('validateFixtureSet / lockFixtureSet', () => {
  function input(fixtures: BenchmarkFixture[], overrides: Partial<FixtureSetValidationInput> = {}): FixtureSetValidationInput {
    return {
      set: set(), project: { status: 'frozen' }, fixtures,
      sourcesById: new Map([['src', frozenSource]]), projectSources: [{ status: 'frozen' }, { status: 'frozen' }, { status: 'validated' }],
      ...overrides,
    }
  }
  const good = buildFixture({ fixtureSetId: 's1', sourceId: 'src', type: 'citation', expected: CITATION_EXPECTED }, set(), frozenSource, [], 'f0', NOW)

  it('passes a clean set, reports coverage, and moves draft to validated', () => {
    const r = validateFixtureSet(input([good]))
    expect(r.ok).toBe(true)
    expect(r.nextStatus).toBe('validated')
    expect(r.coverage).toMatchObject({ totalFixtures: 1, sourcesWithAnyFixture: 1, totalFrozenSources: 2 })
    expect(r.coverage.byType.citation).toBe(1)
  })
  it('reports duplicate ids/ordinals, missing and unfrozen sources, bad shapes, unfrozen project', () => {
    const dup = { ...good }
    const bad = { ...good, id: 'f1', ordinal: 1, sourceId: 'gone' }
    const badShape = { ...good, id: 'f2', ordinal: 2, expected: {} }
    const r = validateFixtureSet(input([good, dup, bad, badShape], { project: { status: 'draft' }, sourcesById: new Map([['src', { corpusProjectId: 'p1', status: 'validated' }]]) }))
    expect(r.ok).toBe(false)
    expect(r.nextStatus).toBe('draft')
    expect(r.errors.join('\n')).toMatch(/must be frozen/)
    expect(r.errors.join('\n')).toMatch(/Duplicate fixture id f0/)
    expect(r.errors.join('\n')).toMatch(/Duplicate ordinal/)
    expect(r.errors.join('\n')).toMatch(/missing source gone/)
    expect(r.errors.join('\n')).toMatch(/is not frozen/)
    expect(r.errors.join('\n')).toMatch(/Fixture f2:/)
  })
  it('reports a missing project', () => {
    expect(validateFixtureSet(input([], { project: null })).errors).toContain('Corpus project not found.')
  })
  it('lock: locks a valid set, leaves an invalid one, refuses locked/archived', () => {
    const locked = lockFixtureSet(input([good]), 'T')
    expect(locked.set.status).toBe('locked')
    expect(locked.set.lockedAt).toBe('T')
    const failed = lockFixtureSet(input([good], { project: { status: 'draft' } }), 'T')
    expect(failed.set.status).toBe('draft')
    expect(failed.result.ok).toBe(false)
    expect(() => lockFixtureSet(input([good], { set: set({ status: 'locked' }) }), 'T')).toThrow(/already locked/)
    expect(() => lockFixtureSet(input([good], { set: set({ status: 'archived' }) }), 'T')).toThrow(/archived/)
  })
})

describe('matching fixtures to sources', () => {
  const a = buildFixture({ fixtureSetId: 's1', sourceId: 'A', type: 'citation', expected: CITATION_EXPECTED, ordinal: 1 }, set(), frozenSource, [], 'a1', NOW)
  const a0 = { ...a, id: 'a0', ordinal: 0 }
  const b = { ...a, id: 'b0', sourceId: 'B' }
  const other = { ...a, id: 'x', fixtureSetId: 's2' }
  it('filters by set and source, ordered by ordinal', () => {
    expect(fixturesForSource([a, a0, b, other], 's1', 'A').map(f => f.id)).toEqual(['a0', 'a1'])
    const by = fixturesBySource([a, a0, b, other], 's1')
    expect([...by.keys()].sort()).toEqual(['A', 'B'])
    expect(by.get('A')!.map(f => f.id)).toEqual(['a0', 'a1'])
  })
})

describe('scanSourceForCandidates / dispatch table / fixture types', () => {
  it('proposes candidates from the four deterministic extractors', () => {
    const c = scanSourceForCandidates('The dose is 5 mg [1]. It must not exceed ISO 27001 limits, per BRCA1 data.')
    expect(c.citation.length).toBeGreaterThan(0)
    expect(c.numeric_unit.length).toBeGreaterThan(0)
    expect(c.modality.map(m => m.exactText.toLowerCase())).toContain('must not')
    expect(c.protected_term.map(t => t.exactText)).toEqual(expect.arrayContaining(['BRCA1', 'ISO 27001']))
  })
  it('maps tests to fixture types and validates shapes by type', () => {
    expect(FIXTURE_TYPE_FOR_TEST['A2H-04']).toBe('citation')
    expect(FIXTURE_TYPE_FOR_TEST['A2H-16']).toBe('claim_relationship')
    expect(FIXTURE_TYPE_FOR_TEST['A2H-08']).toBeUndefined()
    expect(validateExpectedShape('protected_term', { kind: 'k', exactText: 'X1', caseSensitive: true })).toEqual([])
    expect(validateExpectedShape('terminology', {}).length).toBeGreaterThan(0)
  })
  it('dispatches the six fixture-preservation tests', () => {
    expect(Object.keys(DETERMINISTIC_EVALUATORS).sort()).toEqual(['A2H-04', 'A2H-05', 'A2H-09', 'A2H-10', 'A2H-13', 'A2H-16'])
    expect(isDeterministicTest('A2H-04')).toBe(true)
    expect(isDeterministicTest('A2H-01')).toBe(false)
    const f = buildFixture({ fixtureSetId: 's1', sourceId: 'A', type: 'citation', expected: CITATION_EXPECTED }, set(), frozenSource, [], 'a1', NOW)
    const e = DETERMINISTIC_EVALUATORS['A2H-04']!([f], 'see [1] here')
    expect(e.passed).toBe(true)
    expect(e.score).toBe(1)
    expect(DETERMINISTIC_EVALUATORS['A2H-04']!([], 'x').passed).toBeNull()
  })
})

import { describe, it, expect } from 'vitest'
import {
  classifyClaimRelationshipPreservation, computeA2H16Measurements, evaluateClaimRelationshipPreservation,
  aggregateA2H16, validateClaimRelationshipFixtureExpected, type ClaimRelationshipFixtureExpected,
} from '../../src/scoring/a2h16'
import type { BenchmarkFixture } from '../../src/shared/types'

function fixtureExpected(overrides: Partial<ClaimRelationshipFixtureExpected> = {}): ClaimRelationshipFixtureExpected {
  return {
    category: 'causal',
    sourceText: 'Because sales grew sharply, the company increased hiring across every region.',
    relation: 'causes',
    approvedEquivalentForms: ['The company increased hiring across every region as sales grew sharply.'],
    knownCorruptions: [{ type: 'relation-swap', text: 'Because the company increased hiring across every region, sales grew sharply.' }],
    ...overrides,
  }
}

function fixture(expected: ClaimRelationshipFixtureExpected, id = 'fx-1'): BenchmarkFixture {
  return {
    id, fixtureSetId: 'set-1', corpusProjectId: 'proj-1', sourceId: 'src-1', type: 'claim_relationship',
    ordinal: 0, expected: expected as unknown as Record<string, unknown>, sourceStart: null, sourceEnd: null,
    sourceText: null, notes: null, corruptionGeneratorVersion: null, createdAt: '', updatedAt: '',
  }
}

describe('validateClaimRelationshipFixtureExpected', () => {
  it('accepts a well-formed fixture', () => {
    expect(validateClaimRelationshipFixtureExpected(fixtureExpected() as unknown as Record<string, unknown>)).toEqual([])
  })
  it('rejects an invalid category', () => {
    const errors = validateClaimRelationshipFixtureExpected({ ...fixtureExpected(), category: 'not-a-category' } as unknown as Record<string, unknown>)
    expect(errors.some(e => e.includes('category'))).toBe(true)
  })
  it('requires sourceText and relation', () => {
    const errors = validateClaimRelationshipFixtureExpected({ category: 'causal' })
    expect(errors.some(e => e.includes('sourceText'))).toBe(true)
    expect(errors.some(e => e.includes('relation'))).toBe(true)
  })
  it('rejects a malformed knownCorruptions entry', () => {
    const errors = validateClaimRelationshipFixtureExpected({ ...fixtureExpected(), knownCorruptions: ['not-an-object'] } as unknown as Record<string, unknown>)
    expect(errors.some(e => e.includes('knownCorruptions'))).toBe(true)
  })
})

describe('classifyClaimRelationshipPreservation — deterministic, no LLM', () => {
  const expected = fixtureExpected()

  it('preserved: the exact source phrasing survives verbatim', () => {
    expect(classifyClaimRelationshipPreservation(expected, `Intro. ${expected.sourceText} Outro.`)).toBe('preserved')
  })

  it('preserved: an approved equivalent paraphrase survives', () => {
    const output = 'The company increased hiring across every region as sales grew sharply.'
    expect(classifyClaimRelationshipPreservation(expected, output)).toBe('preserved')
  })

  it('corrupted: a known-bad reversed phrasing appears', () => {
    const output = 'Because the company increased hiring across every region, sales grew sharply.'
    expect(classifyClaimRelationshipPreservation(expected, output)).toBe('corrupted')
  })

  it('corrupted wins even if an approved form also appears elsewhere in a longer document', () => {
    const output = `${expected.approvedEquivalentForms![0]} Elsewhere: Because the company increased hiring across every region, sales grew sharply.`
    expect(classifyClaimRelationshipPreservation(expected, output)).toBe('corrupted')
  })

  it('uncertain: neither the approved nor known-corrupted phrasing is recognizable', () => {
    const output = 'Something entirely different happened in the company this year.'
    expect(classifyClaimRelationshipPreservation(expected, output)).toBe('uncertain')
  })

  it('comparative category: reversed comparison detected as corrupted', () => {
    const comparative = fixtureExpected({
      category: 'comparative',
      sourceText: "The vaccine's efficacy was higher in younger adults than in older adults.",
      approvedEquivalentForms: [],
      knownCorruptions: [{ type: 'relation-swap', text: "The vaccine's efficacy was higher in older adults than in younger adults." }],
    })
    expect(classifyClaimRelationshipPreservation(comparative, "The vaccine's efficacy was higher in older adults than in younger adults.")).toBe('corrupted')
  })

  it('attribution category: reassigned speaker detected as corrupted', () => {
    const attribution = fixtureExpected({
      category: 'attribution',
      sourceText: 'According to federal regulators, the drug carries a black-box warning for cardiac risk.',
      approvedEquivalentForms: [],
      knownCorruptions: [{ type: 'attribution-swap', text: 'According to the manufacturer, the drug carries a black-box warning for cardiac risk.' }],
    })
    expect(classifyClaimRelationshipPreservation(attribution, 'According to the manufacturer, the drug carries a black-box warning for cardiac risk.')).toBe('corrupted')
  })

  it('qualifier category: dropped qualifier detected as corrupted', () => {
    const qualifier = fixtureExpected({
      category: 'qualifier',
      sourceText: 'The treatment is effective in most patients with a family history of the condition.',
      approvedEquivalentForms: [],
      knownCorruptions: [{ type: 'qualifier-detachment', text: 'The treatment is effective in most patients.' }],
    })
    expect(classifyClaimRelationshipPreservation(qualifier, 'The treatment is effective in most patients.')).toBe('corrupted')
  })

  it('condition category: flipped polarity detected as corrupted', () => {
    const condition = fixtureExpected({
      category: 'condition',
      sourceText: 'The warranty applies if the product is used indoors.',
      approvedEquivalentForms: [],
      knownCorruptions: [{ type: 'condition-flip', text: 'The warranty applies unless the product is used indoors.' }],
    })
    expect(classifyClaimRelationshipPreservation(condition, 'The warranty applies unless the product is used indoors.')).toBe('corrupted')
  })

  it('exception category: flipped exception scope detected as corrupted', () => {
    const exception = fixtureExpected({
      category: 'exception',
      sourceText: 'All employees must attend the meeting except those on approved leave.',
      approvedEquivalentForms: [],
      knownCorruptions: [{ type: 'exception-flip', text: 'All employees must attend the meeting except those on unapproved leave.' }],
    })
    expect(classifyClaimRelationshipPreservation(exception, 'All employees must attend the meeting except those on unapproved leave.')).toBe('corrupted')
  })
})

describe('computeA2H16Measurements / evaluateClaimRelationshipPreservation', () => {
  it('is ineligible with zero claim_relationship fixtures', () => {
    const m = computeA2H16Measurements([], 'any text')
    expect(m.eligible).toBe(false)
    expect(m.preservationRate).toBeNull()
  })

  it('aggregates preserved/corrupted/uncertain across several fixtures', () => {
    const fixtures = [
      fixture(fixtureExpected(), 'fx-preserved'),
      fixture(fixtureExpected({ sourceText: 'X causes Y.', approvedEquivalentForms: [], knownCorruptions: [{ type: 't', text: 'Y causes X.' }] }), 'fx-corrupted'),
      fixture(fixtureExpected({ sourceText: 'Q relates to R.', approvedEquivalentForms: [], knownCorruptions: [] }), 'fx-uncertain'),
    ]
    const output = `${fixtureExpected().sourceText} Y causes X. Something unrelated.`
    const m = computeA2H16Measurements(fixtures, output)
    expect(m.eligible).toBe(true)
    expect(m.fixtureCount).toBe(3)
    expect(m.preservedCount).toBe(1)
    expect(m.corruptedCount).toBe(1)
    expect(m.uncertainCount).toBe(1)
    expect(m.preservationRate).toBeCloseTo(1 / 3)
  })

  it('evaluateClaimRelationshipPreservation passes only when zero corruptions detected', () => {
    const fixtures = [fixture(fixtureExpected())]
    const outputText = fixtureExpected().sourceText
    const evaluation = evaluateClaimRelationshipPreservation(fixtures, outputText)
    expect(evaluation.passed).toBe(true)
    expect(evaluation.score).toBe(1)
  })

  it('evaluateClaimRelationshipPreservation fails when a corruption is present', () => {
    const fixtures = [fixture(fixtureExpected())]
    const outputText = 'Because the company increased hiring across every region, sales grew sharply.'
    const evaluation = evaluateClaimRelationshipPreservation(fixtures, outputText)
    expect(evaluation.passed).toBe(false)
  })

  it('returns passed: null when ineligible (no claim_relationship fixtures for this output)', () => {
    const fixtures: BenchmarkFixture[] = []
    const outputText = 'anything'
    expect(evaluateClaimRelationshipPreservation(fixtures, outputText).passed).toBeNull()
  })
})

describe('aggregateA2H16', () => {
  it('only counts eligible rows toward preservationRate', () => {
    const ineligible = computeA2H16Measurements([], 'x')
    const eligible = computeA2H16Measurements([fixture(fixtureExpected())], fixtureExpected().sourceText)
    const agg = aggregateA2H16([ineligible, eligible])
    expect(agg.n).toBe(2)
    expect(agg.eligibleN).toBe(1)
    expect(agg.fixtureCount).toBe(1)
    expect(agg.preservedCount).toBe(1)
    expect(agg.preservationRate).toBe(1)
  })
})

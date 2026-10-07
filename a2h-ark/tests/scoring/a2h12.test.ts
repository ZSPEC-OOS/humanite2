import { describe, it, expect } from 'vitest'
import {
  classifyFactualRepair, validateFactualRepairFixtureExpected, proposeFactualRepairCandidates,
  aggregateA2H12, planA2H12, measureA2H12, scoreA2H12, INITIAL_FACTUAL_FIXTURES, type FactualRepairFixtureExpected, type FactualRepairFixtureResult,
} from '../../src/scoring/a2h12'

function fixtureFor(category: FactualRepairFixtureExpected['category']) {
  const f = INITIAL_FACTUAL_FIXTURES.find(x => x.category === category)
  if (!f) throw new Error(`no seed fixture for ${category}`)
  return f
}

describe('classifyFactualRepair — §54 acceptance cases', () => {
  it('50 mg repaired to 5 mg', () => {
    const f = fixtureFor('numeric_substitution')
    const result = classifyFactualRepair(f, f.cleanText)
    expect(result.status).toBe('fully_repaired')
  })

  it('euros repaired to dollars', () => {
    const f = fixtureFor('unit_substitution')
    expect(classifyFactualRepair(f, f.cleanText).status).toBe('fully_repaired')
  })

  it('must repaired to may', () => {
    const f = fixtureFor('modality_change')
    expect(classifyFactualRepair(f, f.cleanText).status).toBe('fully_repaired')
  })

  it('missing "not" restored', () => {
    const f = fixtureFor('negation_deletion')
    expect(classifyFactualRepair(f, f.cleanText).status).toBe('fully_repaired')
  })

  it('p < 0.05 repaired to p > 0.05', () => {
    const f = fixtureFor('comparator_reversal')
    expect(classifyFactualRepair(f, f.cleanText).status).toBe('fully_repaired')
  })

  it('-5% repaired to +5%', () => {
    const f = fixtureFor('sign_reversal')
    expect(classifyFactualRepair(f, f.cleanText).status).toBe('fully_repaired')
  })

  it('20-5 mg repaired to 5-20 mg', () => {
    const f = fixtureFor('range_corruption')
    expect(classifyFactualRepair(f, f.cleanText).status).toBe('fully_repaired')
  })

  it('10^4 repaired to 10^-4', () => {
    const f = fixtureFor('scientific_notation_corruption')
    expect(classifyFactualRepair(f, f.cleanText).status).toBe('fully_repaired')
  })

  it('firmware binding restored', () => {
    const f = fixtureFor('relationship_binding_change')
    expect(classifyFactualRepair(f, f.cleanText).status).toBe('fully_repaired')
  })

  it('Section references restored', () => {
    const f = fixtureFor('cross_reference_swap')
    expect(classifyFactualRepair(f, f.cleanText).status).toBe('fully_repaired')
  })

  it('Compound A/B relationship restored', () => {
    const f = fixtureFor('entity_substitution')
    expect(classifyFactualRepair(f, f.cleanText).status).toBe('fully_repaired')
  })
})

describe('classifyFactualRepair — no repair attempted', () => {
  it.each(INITIAL_FACTUAL_FIXTURES)('$category: unrepaired corrupted text is not_repaired', (f) => {
    expect(classifyFactualRepair(f, f.corruptedText).status).toBe('not_repaired')
  })

  it('null repair output is not_repaired', () => {
    expect(classifyFactualRepair(INITIAL_FACTUAL_FIXTURES[0]!, null).status).toBe('not_repaired')
  })
})

// §55's negative tests — binding and precision matter; a superficially
// plausible but wrong repair must never score as fully_repaired.
describe('classifyFactualRepair — §55 negative tests', () => {
  it('rejects a wrong but superficially similar correction', () => {
    const f = fixtureFor('numeric_substitution') // expects "5 mg"
    const result = classifyFactualRepair(f, 'Store the sample at 15 mg per vial.')
    expect(result.status).not.toBe('fully_repaired')
  })

  it('rejects a partial number match (25 mg does not satisfy "5 mg")', () => {
    const f = fixtureFor('numeric_substitution')
    const result = classifyFactualRepair(f, 'Store the sample at 25 mg per vial.')
    expect(result.status).not.toBe('fully_repaired')
  })

  it('rejects correct value with wrong unit', () => {
    const f = fixtureFor('numeric_substitution') // expects "5 mg"
    const result = classifyFactualRepair(f, 'Store the sample at 5 g per vial.')
    expect(result.status).not.toBe('fully_repaired')
  })

  it('rejects correct unit with wrong value', () => {
    const f = fixtureFor('unit_substitution') // expects "200 dollars"
    const result = classifyFactualRepair(f, 'The shipment weighs 5 kilograms and costs 300 dollars.')
    expect(result.status).not.toBe('fully_repaired')
  })

  it('rejects restored negation attached to the wrong clause', () => {
    const f = fixtureFor('negation_deletion') // anchor "significantly", expects "did not increase" nearby
    const result = classifyFactualRepair(f, 'It is not raining today. The results increased significantly.')
    expect(result.status).not.toBe('fully_repaired')
  })

  it('rejects the correct modal appearing elsewhere in the sentence, unbound', () => {
    const f = fixtureFor('modality_change') // anchor "after 7 days", expects "may discontinue" nearby
    const result = classifyFactualRepair(f, 'It may be noted that patients must discontinue the medication after 7 days.')
    expect(result.status).not.toBe('fully_repaired')
  })

  it('rejects repairing one range endpoint but not the full range', () => {
    const f = fixtureFor('range_corruption') // expects "5 mg to 20 mg"
    const result = classifyFactualRepair(f, 'The dosing range spans from 5 mg to 5 mg.')
    expect(result.status).not.toBe('fully_repaired')
  })

  it('rejects the correct version string assigned to the wrong entity', () => {
    const f = fixtureFor('relationship_binding_change')
    // Both correct strings appear individually, but swapped in binding —
    // this should still fail since the exact bound clauses are checked.
    const result = classifyFactualRepair(f, 'Server Alpha runs firmware 3.4; Server Beta runs firmware 3.4.')
    expect(result.status).not.toBe('fully_repaired')
  })
})

describe('classifyFactualRepair — partial repair', () => {
  it('classifies as partially_repaired when only one of several ground-truth clauses is restored', () => {
    const f = fixtureFor('relationship_binding_change')
    const result = classifyFactualRepair(f, 'Server Alpha runs firmware 2.1; Server Beta runs firmware 2.1.')
    expect(result.status).toBe('partially_repaired')
  })
})

describe('validateFactualRepairFixtureExpected', () => {
  it('accepts every seed fixture', () => {
    for (const f of INITIAL_FACTUAL_FIXTURES) {
      expect(validateFactualRepairFixtureExpected(f as unknown as Record<string, unknown>)).toEqual([])
    }
  })

  it('rejects a corruptedValues entry not present in corruptedText', () => {
    const errors = validateFactualRepairFixtureExpected({
      cleanText: '5 mg', corruptedText: '50 mg', category: 'numeric_substitution',
      expectedGroundTruth: ['5 mg'], corruptedValues: ['500 mg'],
    })
    expect(errors.length).toBeGreaterThan(0)
  })

  it('rejects an invalid category', () => {
    const errors = validateFactualRepairFixtureExpected({
      cleanText: '5 mg', corruptedText: '50 mg', category: 'bogus',
      expectedGroundTruth: ['5 mg'], corruptedValues: ['50 mg'],
    })
    expect(errors.length).toBeGreaterThan(0)
  })
})

describe('proposeFactualRepairCandidates', () => {
  it('returns the curated seed set', () => {
    expect(proposeFactualRepairCandidates()).toHaveLength(INITIAL_FACTUAL_FIXTURES.length)
  })
})

describe('aggregateA2H12', () => {
  it('is ineligible with zero results', () => {
    expect(aggregateA2H12([]).eligible).toBe(false)
  })

  it('primary repairRate counts only fully_repaired, never partial credit', () => {
    const results: FactualRepairFixtureResult[] = [
      { fixtureId: '1', category: 'numeric_substitution', status: 'fully_repaired', presentGroundTruth: ['5 mg'], presentCorrupted: [], repairAttemptId: 'a', repairedText: 'x' },
      { fixtureId: '2', category: 'numeric_substitution', status: 'partially_repaired', presentGroundTruth: [], presentCorrupted: [], repairAttemptId: 'b', repairedText: 'y' },
    ]
    const agg = aggregateA2H12(results)
    expect(agg.repairedCount).toBe(1)
    expect(agg.repairRate).toBe(0.5)
    expect(agg.partialRepairCount).toBe(1)
  })
})

describe('A2H-12 plan/measure', () => {
  const fixture = INITIAL_FACTUAL_FIXTURES[0]!
  const answer = (output: string) => ({ output, latencyMs: null, modelCalls: 1, inputTokens: null, outputTokens: null, retryCount: 0 })

  it('plans one repair_facts call: corrupted text, clean text as the ledger source', () => {
    expect(planA2H12(fixture, 'science')).toEqual([{
      operation: 'repair_facts', text: fixture.corruptedText,
      extra: { sourceText: fixture.cleanText, tone: 'balanced', domain: 'science' },
    }])
  })
  it('measures a fully repaired answer', () => {
    const m = measureA2H12('fx1', fixture, answer(fixture.cleanText))
    expect(m.status).toBe('fully_repaired')
    expect(m.repairAttemptId).toBeNull()
    expect(scoreA2H12(m)).toBe(1)
  })
  it('an unchanged (no-op) answer or no answer is not repaired', () => {
    expect(measureA2H12('fx1', fixture, answer(fixture.corruptedText)).status).toBe('not_repaired')
    const m = measureA2H12('fx1', fixture, null)
    expect(m.status).toBe('not_repaired')
    expect(scoreA2H12(m)).toBe(0)
  })
})

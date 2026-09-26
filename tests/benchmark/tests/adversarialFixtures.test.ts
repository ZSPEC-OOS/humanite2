import { describe, it, expect } from 'vitest'
import { preprocess } from '@/lib/preprocess'
import { checkEntityOverlap } from '@/lib/qualityGates'
import { ADVERSARIAL_FIXTURES } from '../fixtures/adversarial'
import type { AdversarialCategory } from '../types'

// Runs the real deterministic validator — no model calls, per the plan's
// Phase 2 spec for adversarial fixtures — against each fixture pair, and
// checks the result against `currentlyDetected` rather than trusting that
// flag by hand.
function missingFactsAfterCorruption(source: string, corrupted: string): string[] {
  const { fact_locks } = preprocess(source)
  return checkEntityOverlap(corrupted, fact_locks).missing
}

describe('adversarial fixtures — current validator (preprocess.ts + checkEntityOverlap)', () => {
  for (const fixture of ADVERSARIAL_FIXTURES) {
    if (fixture.currentlyDetected) {
      it(`${fixture.id}: caught today`, () => {
        const missing = missingFactsAfterCorruption(fixture.source, fixture.corrupted)
        expect(missing.length).toBeGreaterThan(0)
      })
    } else {
      // Tracked, expected-to-currently-fail. The inner assertion genuinely
      // throws today — this corruption sails through undetected — and
      // it.fails inverts that into a passing run so the suite stays green.
      // The moment a future phase actually closes this gap, this specific
      // test starts failing (an assertion that unexpectedly passed), which
      // is the signal to flip currentlyDetected to true and promote it to
      // a plain it(...) above.
      it.fails(`${fixture.id}: NOT caught today (tracked gap for Phase 5)`, () => {
        const missing = missingFactsAfterCorruption(fixture.source, fixture.corrupted)
        expect(missing.length).toBeGreaterThan(0)
      })
    }
  }

  it('covers every adversarial category the plan names', () => {
    const covered = new Set(ADVERSARIAL_FIXTURES.map(f => f.category))
    const required: AdversarialCategory[] = [
      'unit-quantity', 'modality', 'negation', 'comparator', 'sign',
      'range-endpoint', 'scientific-notation', 'version-number',
      'cross-reference', 'entity-swap',
    ]
    for (const category of required) {
      expect(covered.has(category)).toBe(true)
    }
  })

  it('every fixture id is unique', () => {
    const ids = ADVERSARIAL_FIXTURES.map(f => f.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

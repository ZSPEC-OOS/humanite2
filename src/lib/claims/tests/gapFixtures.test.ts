import { describe, it, expect } from 'vitest'
import { validateFactLedger } from '@/lib/fidelity'
import { CLAIM_FIXTURES } from '../../../../tests/benchmark/fixtures/claimFixtures'

// Phase 2's own convention: commit the fixtures the current validator
// misses as a tracked, currently-passing (i.e. undetected) test — proving
// the gap Phase 7's model-based claim verifier exists to close, checked
// against the real function rather than asserted by hand. If one of these
// ever starts failing here, it means Phase 5's extractors grew a new
// capability that happens to also catch it — the fixture should then move
// to fidelity/tests/adversarialFixtures.test.ts instead of staying here.
describe('Phase 7 claim fixtures — confirmed gap in Phase 5\'s deterministic fact ledger', () => {
  for (const fixture of CLAIM_FIXTURES) {
    it(`${fixture.id}: slips past validateFactLedger today`, () => {
      const result = validateFactLedger(fixture.source, fixture.corrupted)
      expect(result.passed, `expected ${fixture.id} to slip past validateFactLedger, but it was caught: ${JSON.stringify(result.failures)}`).toBe(true)
    })
  }

  it('covers all 9 fixtures currently defined, 3 per category', () => {
    expect(CLAIM_FIXTURES.length).toBe(9)
    expect(CLAIM_FIXTURES.filter(f => f.category === 'relation-swap')).toHaveLength(3)
    expect(CLAIM_FIXTURES.filter(f => f.category === 'attribution-swap')).toHaveLength(3)
    expect(CLAIM_FIXTURES.filter(f => f.category === 'qualifier-detachment')).toHaveLength(3)
  })
})

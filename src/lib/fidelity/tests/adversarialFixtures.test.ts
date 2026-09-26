import { describe, it, expect } from 'vitest'
import { validateFactLedger } from '../validator'
import { ADVERSARIAL_FIXTURES } from '../../../../tests/benchmark/fixtures/adversarial'

// Phase 5's own acceptance criterion: "every deterministic adversarial
// fixture from Phase 2 fails validation." Unlike
// tests/benchmark/tests/adversarialFixtures.test.ts (which checks today's
// pre-Phase-5 validator and tracks gaps via it.fails), this checks the new
// deterministic fact ledger built for this phase — every one of these
// must now be a real, plain failure, not a tracked one.
describe('Phase 5 deterministic fact ledger — every Phase 2 adversarial fixture fails validation', () => {
  for (const fixture of ADVERSARIAL_FIXTURES) {
    it(`${fixture.id}: caught by validateFactLedger`, () => {
      const result = validateFactLedger(fixture.source, fixture.corrupted)
      expect(result.passed, `expected ${fixture.id} to fail validation, but it passed`).toBe(false)
      expect(result.failures.length).toBeGreaterThan(0)
    })
  }

  it('covers all 11 fixtures currently defined', () => {
    expect(ADVERSARIAL_FIXTURES.length).toBeGreaterThanOrEqual(11)
  })
})

// @vitest-environment node
import { describe, it, expect } from 'vitest'
import OpenAI from 'openai'
import { verifyClaims } from '@/lib/claims'
import { buildFactLedger } from '@/lib/fidelity'
import { resolveProvider } from '@/lib/providerResolution'
import { CLAIM_FIXTURES } from '../fixtures/claimFixtures'

// Phase 7's own two acceptance criteria: "every relation-swap, attribution-
// swap and qualifier-detachment fixture fails validation; false-failure
// rate on correct rewrites <= 5%." Both require real model calls — the
// whole point is measuring what an actual judge model does with these
// prompts — so both are gated behind the same RUN_LIVE_BENCHMARK opt-in as
// the other live acceptance tests.
const LIVE = process.env.RUN_LIVE_BENCHMARK === 'true'
const FALSE_FAILURE_RATE_CEILING = 0.05

// Each pair is a source and a CORRECT rewrite — reworded or restructured,
// but never reversing a relation, reassigning attribution, or dropping a
// qualifier — probing the model-based verifier's own false-positive risk
// the same way fidelity/tests/falseFailureRate.test.ts does for the
// deterministic fact ledger.
const CORRECT_REWRITE_PAIRS: Array<{ id: string; source: string; rewrite: string }> = [
  { id: 'causal-reword', source: 'Because sales grew sharply, the company increased hiring across every region.', rewrite: 'The company increased hiring across every region as sales grew sharply.' },
  { id: 'comparative-reword', source: "The vaccine's efficacy was higher in younger adults than in older adults.", rewrite: 'Among younger adults, the vaccine showed higher efficacy than it did among older adults.' },
  { id: 'timing-reword', source: 'Taking the medication before meals improves absorption compared to taking it after meals.', rewrite: 'Absorption improves more when the medication is taken before meals rather than after them.' },
  { id: 'attribution-reword-1', source: 'According to federal regulators, the drug carries a black-box warning for cardiac risk.', rewrite: 'Federal regulators have stated that the drug carries a black-box warning for cardiac risk.' },
  { id: 'attribution-reword-2', source: 'The lead author reported that the effect size was smaller than expected.', rewrite: 'The effect size, the lead author reported, came in smaller than expected.' },
  { id: 'attribution-reword-3', source: 'Sales grew, the chief executive said, due to strong holiday demand.', rewrite: 'The chief executive attributed the sales growth to strong holiday demand.' },
  { id: 'qualifier-reword-1', source: 'The treatment is effective in most patients with a family history of the condition.', rewrite: 'Among patients with a family history of the condition, the treatment is effective for most.' },
  { id: 'qualifier-reword-2', source: 'Side effects are common only during the first week of treatment.', rewrite: "It is only in treatment's first week that side effects are commonly seen." },
  { id: 'qualifier-reword-3', source: 'The policy applies to new customers who sign up during the introductory period.', rewrite: 'New customers who sign up during the introductory period are covered by the policy.' },
  { id: 'mixed-reword-1', source: 'Because the marketing campaign launched in June, website traffic tripled.', rewrite: 'Website traffic tripled after the marketing campaign launched in June.' },
  { id: 'mixed-reword-2', source: 'According to the safety board, the outage was caused by a software update.', rewrite: 'The safety board found that a software update caused the outage.' },
  { id: 'mixed-reword-3', source: 'The discount applies only to members who joined before the promotion ended.', rewrite: 'Only members who joined before the promotion ended qualify for the discount.' },
  { id: 'mixed-reword-4', source: 'Reducing sodium intake lowers blood pressure in most adults.', rewrite: 'In most adults, blood pressure falls when sodium intake is reduced.' },
  { id: 'mixed-reword-5', source: 'The professor, not the teaching assistant, wrote the exam questions.', rewrite: 'It was the professor who wrote the exam questions, not the teaching assistant.' },
  { id: 'mixed-reword-6', source: 'The bridge closure affected commuters only during rush hour.', rewrite: 'Commuters were affected by the bridge closure, but only during rush hour.' },
  { id: 'mixed-reword-7', source: 'Warmer ocean temperatures are driving the increase in coral bleaching.', rewrite: 'The increase in coral bleaching is being driven by warmer ocean temperatures.' },
  { id: 'mixed-reword-8', source: 'Investors, according to the analyst report, are growing cautious about the sector.', rewrite: 'The analyst report says investors are growing cautious about the sector.' },
  { id: 'mixed-reword-9', source: 'The refund policy covers defective items returned within 30 days.', rewrite: 'Defective items returned within 30 days are covered under the refund policy.' },
  { id: 'mixed-reword-10', source: "The city council, not the mayor's office, approved the new zoning rules.", rewrite: "It was the city council, rather than the mayor's office, that approved the new zoning rules." },
]

describe.skipIf(!LIVE)('claim verification acceptance (Phase 7)', () => {
  it(
    'every relation-swap, attribution-swap, and qualifier-detachment fixture fails verification',
    async () => {
      const { apiKey, baseURL, model } = resolveProvider(null)
      const client = new OpenAI({ apiKey, baseURL })

      const outcomes: Array<{ id: string; passed: boolean }> = []
      for (const fixture of CLAIM_FIXTURES) {
        const coveredFacts = buildFactLedger(fixture.source).map(f => f.text)
        const result = await verifyClaims(client, model, fixture.source, fixture.corrupted, coveredFacts)
        outcomes.push({ id: fixture.id, passed: result.passed })
      }

      console.log('claim verification outcomes:', outcomes)
      const missed = outcomes.filter(o => o.passed)
      expect(missed, `expected every fixture to fail verification; these passed instead: ${JSON.stringify(missed)}`).toHaveLength(0)
    },
    { timeout: 5 * 60 * 1000 },
  )

  it(
    `stays at or below the ${FALSE_FAILURE_RATE_CEILING * 100}% false-failure ceiling across the correct-rewrite set`,
    async () => {
      const { apiKey, baseURL, model } = resolveProvider(null)
      const client = new OpenAI({ apiKey, baseURL })

      const failing: string[] = []
      for (const pair of CORRECT_REWRITE_PAIRS) {
        const coveredFacts = buildFactLedger(pair.source).map(f => f.text)
        const result = await verifyClaims(client, model, pair.source, pair.rewrite, coveredFacts)
        if (!result.passed) failing.push(`${pair.id}: ${result.failures.map(f => f.reason).join('; ')}`)
      }

      const failureRate = failing.length / CORRECT_REWRITE_PAIRS.length
      if (failing.length > 0) console.log('False failures:', failing)
      expect(failureRate, `false-failure rate ${(failureRate * 100).toFixed(1)}% (${failing.length}/${CORRECT_REWRITE_PAIRS.length})`).toBeLessThanOrEqual(FALSE_FAILURE_RATE_CEILING)
    },
    { timeout: 5 * 60 * 1000 },
  )
})

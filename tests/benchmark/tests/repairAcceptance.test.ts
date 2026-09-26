// @vitest-environment node
import { describe, it, expect } from 'vitest'
import OpenAI from 'openai'
import { repairChunk } from '@/lib/evaluation/repair'
import { resolveProvider } from '@/lib/providerResolution'
import { ADVERSARIAL_FIXTURES } from '../fixtures/adversarial'

// Reuses Phase 2's 11 adversarial fixtures as simulated first-attempt
// failures — each fixture's `corrupted` text is exactly the kind of
// position-blind fact error (a value swap, a dropped negation, a flipped
// comparator) the ordinary whole-document gates can miss, and its `source`
// is the ground truth a real generation attempt would have started from.
// Feeding these into repairChunk measures the targeted repair mechanism's
// real-world success rate directly, without constructing a separate set of
// failure scenarios. Requires real model calls, so it's gated behind the
// same RUN_LIVE_BENCHMARK opt-in as the other live acceptance tests.
const LIVE = process.env.RUN_LIVE_BENCHMARK === 'true'
const SUCCESS_RATE_THRESHOLD = 0.8

describe.skipIf(!LIVE)('repair acceptance — targeted sentence repair fixes most fact/relation failures', () => {
  it(
    `fixes at least ${SUCCESS_RATE_THRESHOLD * 100}% of the Phase 2 adversarial fixtures`,
    async () => {
      const { apiKey, baseURL, model } = resolveProvider(null)
      const client = new OpenAI({ apiKey, baseURL })

      const outcomes: Array<{ id: string; succeeded: boolean; attempted: boolean }> = []
      for (const fixture of ADVERSARIAL_FIXTURES) {
        const result = await repairChunk(client, model, fixture.source, fixture.corrupted, 'balanced', 'general')
        outcomes.push({ id: fixture.id, succeeded: result.succeeded, attempted: result.attempted })
      }

      console.log('repair outcomes:', outcomes)

      const successRate = outcomes.filter(o => o.succeeded).length / outcomes.length
      expect(successRate, `repair success rate ${(successRate * 100).toFixed(1)}% (${JSON.stringify(outcomes)})`).toBeGreaterThanOrEqual(SUCCESS_RATE_THRESHOLD)
    },
    { timeout: 10 * 60 * 1000 },
  )
})

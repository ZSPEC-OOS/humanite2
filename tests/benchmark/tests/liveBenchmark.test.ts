import { describe, it, expect } from 'vitest'
import OpenAI from 'openai'
import { resolveProvider } from '@/lib/providerResolution'
import { runBenchmark } from '../runBenchmark'
import { writeReport, formatSummary } from '../report'

// Spends real money against a real model and real detector providers — the
// full 60-item corpus, at up to 9 model calls per chunk (see the plan's
// Budget section), is not something to run on every `vitest run`. Gated
// behind an explicit opt-in so CI and routine local test runs never trigger
// it by accident.
//
// To run for real:
//   RUN_LIVE_BENCHMARK=true OPENAI_API_KEY=... pnpm benchmark
// (GPTZERO_API_KEY / SAPLING_API_KEY are optional — a detector without a
// configured key reports PROVIDER_UNAUTHORIZED per-item rather than
// aborting the run; see runOneItem's per-detector try/catch.)
const LIVE = process.env.RUN_LIVE_BENCHMARK === 'true'

describe.skipIf(!LIVE)('runBenchmark — live run against the current pipeline (opt-in, real cost)', () => {
  it(
    'produces and persists a report for the full 60-item corpus',
    async () => {
      const { apiKey, baseURL, model } = resolveProvider(null)
      const client = new OpenAI({ apiKey, baseURL })

      const report = await runBenchmark({ client, model })

      expect(report.itemCount).toBe(60)
      const path = writeReport(report)
      console.log(formatSummary(report))
      console.log(`\nFull report written to ${path}`)
    },
    { timeout: 30 * 60 * 1000 },
  )
})

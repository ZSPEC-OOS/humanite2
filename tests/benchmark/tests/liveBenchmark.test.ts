// @vitest-environment node
import { join } from 'path'
import { describe, it, expect } from 'vitest'
import OpenAI from 'openai'
import { resolveProvider } from '@/lib/providerResolution'
import { runBenchmark } from '../runBenchmark'
import { writeReport, formatSummary } from '../report'
import { CORPUS, corpusByDomain } from '../corpus'
import { DOMAINS, type Domain } from '../types'

// Spends real money against a real model and real detector providers — the
// full 300-item corpus (grown from 60 in the Phase 11 scale-up), at up to 9
// model calls per chunk (see the plan's Budget section), is not something to
// run on every `vitest run`. Gated behind an explicit opt-in so CI and
// routine local test runs never trigger it by accident.
//
// To run for real:
//   RUN_LIVE_BENCHMARK=true OPENAI_API_KEY=... pnpm benchmark
// (GPTZERO_API_KEY / SAPLING_API_KEY are optional — a detector without a
// configured key reports PROVIDER_UNAUTHORIZED per-item rather than
// aborting the run; see runOneItem's per-detector try/catch.)
const LIVE = process.env.RUN_LIVE_BENCHMARK === 'true'

// A single 300-item job ran long enough to hit CI's own job timeout before
// finishing (up to 9 model calls per chunk, times 300 items, at real
// network latency, easily runs for hours). BENCHMARK_DOMAIN splits the run
// into one 50-item shard per domain — see the live-benchmark workflow's
// baseline matrix — cutting a single job's wall-clock time roughly 6x.
// Unset (the default), this runs the full 300-item corpus exactly as
// before, so nothing changes for a caller that doesn't set it.
const SHARD_DOMAIN = process.env.BENCHMARK_DOMAIN as Domain | undefined
if (SHARD_DOMAIN && !DOMAINS.includes(SHARD_DOMAIN)) {
  throw new Error(`BENCHMARK_DOMAIN must be one of ${DOMAINS.join(', ')}, got "${SHARD_DOMAIN}"`)
}
const items = SHARD_DOMAIN ? corpusByDomain(SHARD_DOMAIN) : CORPUS
const expectedItemCount = items.length
const runLabel = SHARD_DOMAIN ? `the ${SHARD_DOMAIN} domain shard (${items.length} items)` : 'the full 300-item corpus'

// Checkpointed after every item (see runBenchmark's checkpointPath option)
// so a run killed by the job's own timeout still leaves everything already
// measured on disk, and a re-run with the same checkpoint path resumes
// instead of re-running (and re-billing) completed items.
const checkpointPath = process.env.BENCHMARK_CHECKPOINT_PATH
  || join(__dirname, '..', 'results', 'checkpoints', `${SHARD_DOMAIN ?? 'full'}.json`)

describe.skipIf(!LIVE)('runBenchmark — live run against the current pipeline (opt-in, real cost)', () => {
  it(
    `produces and persists a report for ${runLabel}`,
    async () => {
      const { apiKey, baseURL, model } = resolveProvider(null)
      const client = new OpenAI({ apiKey, baseURL })

      const report = await runBenchmark({
        client,
        model,
        items,
        checkpointPath,
        resumeFromCheckpoint: true,
      })

      expect(report.itemCount).toBe(expectedItemCount)
      const path = writeReport(report, SHARD_DOMAIN ? `shard-${SHARD_DOMAIN}.json` : undefined)
      console.log(formatSummary(report))
      console.log(`\nFull report written to ${path}`)
    },
    // A 50-item domain shard needs proportionally less wall-clock time than
    // the full 300-item corpus — a smaller, safer ceiling that still gives
    // real headroom rather than inheriting the full run's 90-minute budget
    // for 1/6th the work.
    { timeout: (SHARD_DOMAIN ? 40 : 90) * 60 * 1000 },
  )
})

// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { readShardReports, combineShardReports } from '../aggregateShards'
import { writeReport, formatSummary } from '../report'

// The live-benchmark workflow's baseline job now runs as 6 per-domain
// matrix shards (see .github/workflows/live-benchmark.yml) instead of one
// 300-item job — this is the follow-up "aggregate" job that downloads all
// 6 shards' JSON reports and combines them back into one report with the
// same shape (and the same summary formulas — see aggregateShards.ts) a
// single monolithic run would have produced. No live model calls here,
// only file I/O, so it isn't gated behind RUN_LIVE_BENCHMARK — but it has
// nothing to do outside the aggregation job, so it's gated behind its own
// opt-in env var instead, the same convention every other env-gated test
// in this suite already uses.
const SHARD_DIR = process.env.BENCHMARK_SHARD_DIR

describe.skipIf(!SHARD_DIR)('aggregate per-domain baseline shards into one combined report', () => {
  it('combines every shard report in BENCHMARK_SHARD_DIR into one report', () => {
    const reports = readShardReports(SHARD_DIR!)
    const combined = combineShardReports(reports)

    console.log(formatSummary(combined))
    const path = writeReport(combined, 'combined.json')
    console.log(`\nCombined report written to ${path}`)

    expect(combined.results.length).toBe(reports.reduce((sum, r) => sum + r.itemCount, 0))
  })
})

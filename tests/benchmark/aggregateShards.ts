import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import type { BenchmarkReport } from './types'
import { buildReport } from './runBenchmark'

// Reads every *.json file in `dir` as a per-shard BenchmarkReport — the
// exact shape writeReport (report.ts) already persists, one file per
// domain shard in the live-benchmark workflow's baseline matrix.
export function readShardReports(dir: string): BenchmarkReport[] {
  const files = readdirSync(dir).filter(f => f.endsWith('.json')).sort()
  if (files.length === 0) throw new Error(`readShardReports: no .json shard files found in ${dir}`)
  return files.map(f => JSON.parse(readFileSync(join(dir, f), 'utf8')) as BenchmarkReport)
}

// Combines N per-domain shard reports into one report with the exact same
// shape (and, for entity/similarity/fidelity/retry/latency/token/cost/
// violation metrics, the exact same formulas — see buildReport) a single
// monolithic run over every shard's items combined would have produced.
// The summary is recomputed from the FULL concatenated results array
// rather than averaged from each shard's own already-computed summary, so
// a metric like meanEntityPreservation is the true mean across every item
// rather than a mean-of-means (which would silently misweight shards of
// different sizes — not the case today, since every domain shard is the
// same 50 items, but not a distinction to leave the math wrong about).
export function combineShardReports(reports: BenchmarkReport[]): BenchmarkReport {
  if (reports.length === 0) throw new Error('combineShardReports: no shard reports to combine')

  const model = reports[0]!.model
  const results = reports.flatMap(r => r.results)

  // Each shard calibrates its own detector threshold against only its own
  // domain's reference passages (calibrateDetector in runBenchmark.ts), so
  // this combines shard-level rates via a weighted average (weighted by
  // each shard's item count) rather than the single threshold a monolithic
  // run would compute by pooling reference passages across all domains at
  // once. Identical in practice as of this writing — every shard reports
  // null for every detector, since tests/benchmark/reference/index.ts's
  // REFERENCE_PASSAGES is still unpopulated (see that file's own doc
  // comment) — but worth re-verifying once real reference data exists and
  // this stops being a distinction without a difference.
  const detectorIds = new Set(reports.flatMap(r => Object.keys(r.summary.detectorAiRateAtFixedFpr)))
  const detectorAiRateAtFixedFpr: Record<string, number | null> = {}
  for (const id of detectorIds) {
    const weighted = reports
      .map(r => ({ rate: r.summary.detectorAiRateAtFixedFpr[id], weight: r.itemCount }))
      .filter((w): w is { rate: number; weight: number } => w.rate != null)
    detectorAiRateAtFixedFpr[id] = weighted.length
      ? weighted.reduce((sum, w) => sum + w.rate * w.weight, 0) / weighted.reduce((sum, w) => sum + w.weight, 0)
      : null
  }

  const combined = buildReport(model, results, detectorAiRateAtFixedFpr)
  // buildReport stamps its own "now" as generatedAt — overridden here with
  // the latest of the shards' own timestamps so the combined report's
  // generatedAt reflects when the underlying (possibly hours-long) shard
  // runs actually finished, not when the aggregation step happened to run.
  const latestShardTimestamp = reports.reduce((latest, r) => (r.generatedAt > latest ? r.generatedAt : latest), reports[0]!.generatedAt)
  return { ...combined, generatedAt: latestShardTimestamp }
}

import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import type { BenchmarkReport } from './types'
import type { ScaleUpReport } from './runBenchmark'

const RESULTS_DIR = join(__dirname, 'results')

// Persists a report as JSON under tests/benchmark/results/ — one file per
// run, timestamped by default, so successive runs are never overwritten and
// the acceptance criterion ("harness produces a report for the current
// pipeline") has a durable artifact to point at.
export function writeReport(report: BenchmarkReport, filename?: string): string {
  mkdirSync(RESULTS_DIR, { recursive: true })
  const name = filename ?? `${report.generatedAt.replace(/[:.]/g, '-')}.json`
  const path = join(RESULTS_DIR, name)
  writeFileSync(path, JSON.stringify(report, null, 2))
  return path
}

function pct(n: number | null): string {
  return n == null ? 'n/a' : `${(n * 100).toFixed(1)}%`
}

export function formatSummary(report: BenchmarkReport): string {
  const s = report.summary
  const lines = [
    `Benchmark report — ${report.generatedAt}`,
    `Model: ${report.model}`,
    `Items: ${report.itemCount}`,
    '',
    `Fact preservation (mean entity_preservation): ${pct(s.meanEntityPreservation)}`,
    `Semantic fidelity (mean semantic_similarity): ${pct(s.meanSemanticSimilarity)}`,
    `Fidelity pass rate: ${pct(s.fidelityPassRate)}`,
    `Retry rate: ${pct(s.retryRate)}`,
    `Mean latency: ${s.meanLatencyMs.toFixed(0)} ms`,
    `Total tokens: ${s.totalTokens.toLocaleString()}`,
    `Estimated cost: $${s.totalEstimatedCostUsd.toFixed(4)}`,
    `Prohibited-change violations: ${s.prohibitedChangeViolations}`,
    '',
    'Detector AI-rate at fixed false-positive rate:',
    ...Object.entries(s.detectorAiRateAtFixedFpr).map(([id, rate]) =>
      `  ${id}: ${rate == null ? 'unavailable — needs a populated human reference set (see reference/index.ts)' : pct(rate)}`,
    ),
  ]
  return lines.join('\n')
}

// Same persistence convention as writeReport above, for a Phase 11
// runScaleUpSweep result — a distinct shape (a grid of per-cell
// BenchmarkReports rather than one flat report), so it gets its own writer
// rather than being forced through writeReport's single-report shape.
export function writeScaleUpReport(report: ScaleUpReport, filename?: string): string {
  mkdirSync(RESULTS_DIR, { recursive: true })
  const name = filename ?? `scaleup-${report.generatedAt.replace(/[:.]/g, '-')}.json`
  const path = join(RESULTS_DIR, name)
  writeFileSync(path, JSON.stringify(report, null, 2))
  return path
}

export function formatScaleUpSummary(report: ScaleUpReport): string {
  const lines = [
    `Scale-up sweep report — ${report.generatedAt}`,
    `Model: ${report.model}`,
    `Items per cell: ${report.itemCount}`,
    `Tones: ${report.tones.join(', ')}`,
    `Intensities: ${report.intensities.join(', ')}`,
    '',
    'Cell'.padEnd(24) + 'FidelityPass'.padEnd(14) + 'MeanLatencyMs'.padEnd(16) + 'Cost',
    ...report.cells.map(cell => {
      const s = cell.report.summary
      return `${cell.tone}/${cell.intensity}`.padEnd(24)
        + pct(s.fidelityPassRate).padEnd(14)
        + s.meanLatencyMs.toFixed(0).padEnd(16)
        + `$${s.totalEstimatedCostUsd.toFixed(4)}`
    }),
  ]
  return lines.join('\n')
}

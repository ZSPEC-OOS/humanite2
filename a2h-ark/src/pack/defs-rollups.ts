// A2H-03 (length performance) and A2H-17 (operational efficiency) have no trials of their own: they are pure
// aggregations over what the other tests already measured. They are therefore planned with zero trials and
// emitted by `aggregate` at batch level, where every scored result is visible.
import { buildA2H03Report } from '../scoring/a2h03'
import { buildA2H17Report, type OperationRecord } from '../scoring/a2h17'
import type { A2H01Row } from '../scoring/a2h01'
import type { A2H02Row } from '../scoring/a2h02'
import { rows01, rows02 } from './defs-conversion'
import { parts } from './defs-common'
import { toJsonObject } from './util'
import type { AggregateParts, ScoredItem, TestDef } from './suite'

const noTrials = (): never => {
  throw new Error('This test has no trials of its own')
}

export const a2h03: TestDef = {
  code: 'A2H-03',
  category: 'conversion',
  description:
    'Length performance: a roll-up of A2H-01 (conversion) and A2H-02 (transformation) by the sources\' target length, with optional breakdowns by domain and intensity. It has no trials of its own and appears in the batch-level result; it needs A2H-01 and A2H-02 in the same run.',
  defaultEnabled: true,
  experimental: false,
  needsDetector: false,
  needsFixtures: false,
  timeoutMs: 60_000,
  defaultTrialCount: 1,
  design: () => ({ pool: 'none', cohort: 'A2H-03', cells: 1 }),
  buildSpec: noTrials,
  evaluate: noTrials,
  aggregate: () => parts({ numeric: null, unit: 'ratio', metrics: {}, report: {} }),
}

export const a2h17: TestDef = {
  code: 'A2H-17',
  category: 'operations',
  description:
    'Operational efficiency: latency percentiles, tokens, model calls, retries, failures and timeouts over every target call the run made, overall and by domain, length, intensity, model, test and operation type. It has no trials of its own and appears in the batch-level result.',
  defaultEnabled: false,
  experimental: false,
  needsDetector: false,
  needsFixtures: false,
  timeoutMs: 60_000,
  defaultTrialCount: 1,
  design: () => ({ pool: 'none', cohort: 'A2H-17', cells: 1 }),
  buildSpec: noTrials,
  evaluate: noTrials,
  aggregate: () => parts({ numeric: null, unit: 'ms', metrics: {}, report: {} }),
}

/**
 * A2H-03 over the scored A2H-01 and A2H-02 results of the batch: by length (always), and stratified by domain and by
 * intensity. The same function Humanite used joins the two tests' rows; it only needs the rows.
 */
export function a2h03Rollup(items01: readonly ScoredItem[], items02: readonly ScoredItem[]): AggregateParts {
  const r1: A2H01Row[] = rows01(items01)
  const r2: A2H02Row[] = rows02(items02)
  const byLength = buildA2H03Report(r1, r2).byLength
  const byDomain = buildA2H03Report(r1, r2, undefined, 'domain').stratified
  const byIntensity = buildA2H03Report(r1, r2, undefined, 'intensity').stratified
  return parts({
    numeric: null,
    unit: 'ratio',
    metrics: { a2h01Rows: r1.length, a2h02Rows: r2.length, lengths: byLength.length },
    report: { byLength, byDomain, byIntensity, note: 'A2H-01 and A2H-02 are separate trials in this benchmark, joined by length (and domain or intensity), not by source output.' },
  })
}

/** A2H-17 over every operation record the scored results carry. */
export function a2h17Rollup(records: readonly OperationRecord[]): AggregateParts {
  const report = buildA2H17Report([...records])
  const o = report.overall
  return parts({
    numeric: o.latencyMs.mean,
    unit: 'ms',
    direction: 'lower-is-better',
    metrics: {
      operations: o.n,
      latencyMs_mean: o.latencyMs.mean,
      latencyMs_median: o.latencyMs.median,
      latencyMs_p90: o.latencyMs.p90,
      latencyMs_p95: o.latencyMs.p95,
      latencyMs_p99: o.latencyMs.p99,
      inputTokens_total: o.inputTokens.total,
      outputTokens_total: o.outputTokens.total,
      modelCalls_total: o.modelCalls.total,
      pipelineRetries_total: o.pipelineRetries.total,
      jobRetries_total: o.jobRetries.total,
      failures: o.failures.count,
      timeouts: o.timeouts.count,
    },
    report: toJsonObject({
      ...report,
      note: 'Only trials that completed are scored, so failures and timeouts of whole trials do not appear here; jobRetries counts trial attempts beyond the first. Cost is not reported by the target.',
    }),
  })
}

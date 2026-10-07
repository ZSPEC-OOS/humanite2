import type { Domain } from '../vendor/style/types'
import type { TargetCallResult } from '../shared/targetCalls'
import type { A2HTestCode, TelemetryScope } from '../shared/types'
import { mean, median, percentile, groupBy } from '../shared/statistics'

export const A2H17_CODE = 'A2H-17' as const

// A2H-17 — Operational Efficiency. Pure aggregation over the telemetry every other paid operation
// the benchmark performs already captured (one OperationRecord per target call or trial). It
// performs no target call of its own.

export type OperationType = 'humanite_transform' | 'repair' | 'trial_a2h07' | 'trial_a2h11' | 'trial_a2h14' | 'trial_a2h15'

export interface OperationRecord {
  operation: OperationType
  benchmarkCode: A2HTestCode | null
  domainId: Domain | null
  targetWords: number | null
  intensity: number | null
  requestedIntensity: number | null
  appliedIntensity: number | null
  intensityCapped: boolean | null
  model: string
  latencyMs: number | null
  inputTokens: number | null
  outputTokens: number | null
  modelCalls: number | null
  // §17 of the "Final Polish" patch: modelCalls/inputTokens/outputTokens
  // above cover PRIMARY generation only (see TelemetryScope) — every
  // record this codebase produces today is 'primary_generation_only'; this
  // field exists so a report/export can never silently start implying
  // "total" once (if ever) complete instrumentation lands for some records
  // but not others.
  telemetryScope: TelemetryScope
  // §19: two DIFFERENT retry concepts that must never be conflated — a
  // Humanite quality-gate/candidate retry (pipelineRetryCount, from the
  // pipeline's own ChunkResult/TrialRunResult/RepairCallResult telemetry)
  // is not the same event as a provider 429/500 causing the surrounding
  // BenchmarkJob itself to be re-claimed and re-attempted
  // (jobAttemptCount/jobRetryCount, from the job's own attemptCount). null
  // only when no correlating BenchmarkJob could be found (should not
  // normally happen for a persisted record, but this is aggregation code
  // reading raw data, not a place to assume that never happens).
  pipelineRetryCount: number
  jobAttemptCount: number | null
  jobRetryCount: number | null
  estimatedCostUsd: number | null
  status: 'success' | 'failed'
  // No dedicated timeout flag exists anywhere in this codebase yet (§31/§33
  // ask for one) — approximated from the recorded error, documented rather
  // than fabricated: true only when errorCode/errorMessage plainly names a
  // timeout, never inferred from latency alone.
  timedOut: boolean
}

export function looksLikeTimeout(errorCode: string | null, errorMessage: string | null): boolean {
  const text = `${errorCode ?? ''} ${errorMessage ?? ''}`.toLowerCase()
  return text.includes('timeout') || text.includes('timed out')
}


// The pure half of Humanite's collectOperationRecords: builds one OperationRecord from a target
// call's telemetry. `jobAttemptCount` is the surrounding job's attempt count when known (jobRetryCount
// = max(0, attempts - 1)); null when no correlating job exists, which the summary excludes rather
// than counting as 0.
export interface OperationFromCallInput {
  operation: OperationType
  benchmarkCode: A2HTestCode | null
  domainId: Domain | null
  targetWords: number | null
  intensity: number | null
  requestedIntensity: number | null
  appliedIntensity: number | null
  intensityCapped: boolean | null
  model: string
  estimatedCostUsd: number | null
  status: 'success' | 'failed'
  errorCode: string | null
  errorMessage: string | null
  jobAttemptCount: number | null
}

export function operationRecordFromCall(input: OperationFromCallInput, telemetry: Pick<TargetCallResult, 'latencyMs' | 'modelCalls' | 'inputTokens' | 'outputTokens' | 'retryCount'>): OperationRecord {
  return {
    operation: input.operation, benchmarkCode: input.benchmarkCode, domainId: input.domainId, targetWords: input.targetWords,
    intensity: input.intensity, requestedIntensity: input.requestedIntensity, appliedIntensity: input.appliedIntensity, intensityCapped: input.intensityCapped,
    model: input.model, latencyMs: telemetry.latencyMs, inputTokens: telemetry.inputTokens, outputTokens: telemetry.outputTokens, modelCalls: telemetry.modelCalls,
    telemetryScope: 'primary_generation_only', pipelineRetryCount: telemetry.retryCount,
    jobAttemptCount: input.jobAttemptCount, jobRetryCount: input.jobAttemptCount == null ? null : Math.max(0, input.jobAttemptCount - 1),
    estimatedCostUsd: input.estimatedCostUsd, status: input.status, timedOut: looksLikeTimeout(input.errorCode, input.errorMessage),
  }
}

// ── Aggregation (§33) ─────────────────────────────────────────────────────

export interface OperationalSummary {
  n: number
  latencyMs: { mean: number | null; median: number | null; p90: number | null; p95: number | null; p99: number | null }
  inputTokens: { mean: number | null; median: number | null; total: number | null }
  outputTokens: { mean: number | null; median: number | null; total: number | null }
  modelCalls: { mean: number | null; median: number | null; total: number | null }
  // §19: Humanite's own internal candidate/quality-gate retries — NOT the
  // same event as a BenchmarkJob being re-claimed after a provider error
  // (see jobRetries below).
  pipelineRetries: { mean: number | null; retryRate: number | null; total: number }
  // §19: how many times the surrounding BenchmarkJob itself had to be
  // re-claimed (attemptCount - 1) — e.g. a 429/500 causing markJobFailed to
  // schedule a retry. null-safe: a record with no correlating job
  // contributes nothing rather than skewing the mean toward 0.
  jobRetries: { mean: number | null; retryRate: number | null; total: number | null }
  costUsd: { meanPerOperation: number | null; total: number | null }
  failures: { count: number; rate: number | null }
  timeouts: { count: number; rate: number | null }
}

function numericStats(values: Array<number | null>): { mean: number | null; median: number | null; total: number | null } {
  const present = values.filter((v): v is number => v != null)
  if (present.length === 0) return { mean: null, median: null, total: null }
  return { mean: mean(present), median: median(present), total: present.reduce((a, b) => a + b, 0) }
}

export function summarizeOperations(records: OperationRecord[]): OperationalSummary {
  const n = records.length
  const latencies = records.map(r => r.latencyMs).filter((v): v is number => v != null)
  const inputTokenStats = numericStats(records.map(r => r.inputTokens))
  const outputTokenStats = numericStats(records.map(r => r.outputTokens))
  const modelCallStats = numericStats(records.map(r => r.modelCalls))
  const pipelineRetryValues = records.map(r => r.pipelineRetryCount)
  const withPipelineRetry = records.filter(r => r.pipelineRetryCount > 0)
  const jobRetryValues = records.map(r => r.jobRetryCount).filter((v): v is number => v != null)
  const withJobRetry = jobRetryValues.filter(v => v > 0)
  const costs = records.map(r => r.estimatedCostUsd).filter((v): v is number => v != null)
  const failures = records.filter(r => r.status === 'failed')
  const timeouts = records.filter(r => r.timedOut)

  return {
    n,
    latencyMs: {
      mean: latencies.length ? mean(latencies) : null,
      median: latencies.length ? median(latencies) : null,
      p90: latencies.length ? percentile(latencies, 90) : null,
      p95: latencies.length ? percentile(latencies, 95) : null,
      p99: latencies.length ? percentile(latencies, 99) : null,
    },
    inputTokens: inputTokenStats,
    outputTokens: outputTokenStats,
    modelCalls: modelCallStats,
    pipelineRetries: {
      mean: n > 0 ? mean(pipelineRetryValues) : null,
      retryRate: n === 0 ? null : withPipelineRetry.length / n,
      total: pipelineRetryValues.reduce((a, b) => a + b, 0),
    },
    jobRetries: {
      mean: jobRetryValues.length > 0 ? mean(jobRetryValues) : null,
      retryRate: jobRetryValues.length === 0 ? null : withJobRetry.length / jobRetryValues.length,
      total: jobRetryValues.length > 0 ? jobRetryValues.reduce((a, b) => a + b, 0) : null,
    },
    costUsd: { meanPerOperation: costs.length ? mean(costs) : null, total: costs.length ? costs.reduce((a, b) => a + b, 0) : null },
    failures: { count: failures.length, rate: n === 0 ? null : failures.length / n },
    timeouts: { count: timeouts.length, rate: n === 0 ? null : timeouts.length / n },
  }
}

export interface A2H17Report {
  overall: OperationalSummary
  byDomain: Record<string, OperationalSummary>
  byLength: Record<number, OperationalSummary>
  byIntensity: Record<number, OperationalSummary>
  byModel: Record<string, OperationalSummary>
  byBenchmarkTest: Record<string, OperationalSummary>
  byOperationType: Record<string, OperationalSummary>
}

function grouped<K extends string | number>(records: OperationRecord[], keyFn: (r: OperationRecord) => K | null): Record<K, OperationalSummary> {
  const withKey = records.filter((r): r is OperationRecord & { __k: K } => keyFn(r) != null)
  const groups = groupBy(withKey, r => keyFn(r) as K)
  const result = {} as Record<K, OperationalSummary>
  for (const [key, group] of groups) result[key] = summarizeOperations(group)
  return result
}

// The pure half of Humanite's getA2H17Report (records in, grouped report out).
export function buildA2H17Report(records: OperationRecord[]): A2H17Report {
  return {
    overall: summarizeOperations(records),
    byDomain: grouped(records, r => r.domainId),
    byLength: grouped(records, r => r.targetWords),
    byIntensity: grouped(records, r => r.intensity),
    byModel: grouped(records, r => r.model),
    byBenchmarkTest: grouped(records, r => r.benchmarkCode),
    byOperationType: grouped(records, r => r.operation),
  }
}

import type { Firestore } from 'firebase-admin/firestore'
import type { Domain } from '@/lib/style/types'
import type { A2HTestCode, TelemetryScope, BenchmarkExperimentalTestCode } from './types'
import { listOutputsForRun } from './outputs'
import { listTrialsForRun } from './trials'
import { listRepairAttemptsForRun } from './repairAttempts'
import { listRunSources, getRun } from './runs'
import { listJobsForRun, transformJobId, experimentalTrialJobId, repairEvaluationJobId } from './jobs'
import { mean, median, percentile, groupBy } from './statistics'

export const A2H17_CODE = 'A2H-17' as const

// A2H-17 — Operational Efficiency (§30-35). Pure aggregation over telemetry
// already captured by every other paid operation this benchmark performs
// (BenchmarkOutput, BenchmarkTrial, BenchmarkRepairAttempt) — no new corpus,
// no new Humanite generation pass, and (per §32) no new BenchmarkOperation
// entity: the three existing tables already carry every field this test
// needs, so duplicating them into a fourth collection would violate §32's
// own "do not duplicate information unnecessarily" instruction.

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

function looksLikeTimeout(errorCode: string | null, errorMessage: string | null): boolean {
  const text = `${errorCode ?? ''} ${errorMessage ?? ''}`.toLowerCase()
  return text.includes('timeout') || text.includes('timed out')
}

const EXPERIMENTAL_CODE_FOR_OPERATION: Record<'trial_a2h07' | 'trial_a2h11' | 'trial_a2h14' | 'trial_a2h15', BenchmarkExperimentalTestCode> = {
  trial_a2h07: 'A2H-07', trial_a2h11: 'A2H-11', trial_a2h14: 'A2H-14', trial_a2h15: 'A2H-15',
}

export async function collectOperationRecords(firestore: Firestore, runId: string): Promise<OperationRecord[]> {
  const [run, outputs, trials, repairAttempts, cohort, jobs] = await Promise.all([
    getRun(firestore, runId),
    listOutputsForRun(firestore, runId),
    listTrialsForRun(firestore, runId),
    listRepairAttemptsForRun(firestore, runId),
    listRunSources(firestore, runId),
    listJobsForRun(firestore, runId),
  ])
  const cohortBySource = new Map(cohort.map(row => [row.sourceId, row]))
  const jobById = new Map(jobs.map(j => [j.id, j]))

  function jobRetryFields(jobId: string): { jobAttemptCount: number | null; jobRetryCount: number | null } {
    const job = jobById.get(jobId)
    if (!job) return { jobAttemptCount: null, jobRetryCount: null }
    return { jobAttemptCount: job.attemptCount, jobRetryCount: Math.max(0, job.attemptCount - 1) }
  }

  const records: OperationRecord[] = []

  for (const o of outputs) {
    records.push({
      operation: 'humanite_transform', benchmarkCode: null, domainId: o.domainId, targetWords: o.targetWords, intensity: o.intensity,
      requestedIntensity: o.requestedIntensity, appliedIntensity: o.appliedIntensity, intensityCapped: o.intensityCapped,
      model: o.model, latencyMs: o.latencyMs, inputTokens: o.inputTokens, outputTokens: o.outputTokens, modelCalls: o.modelCalls,
      telemetryScope: o.telemetryScope, pipelineRetryCount: o.retryCount, ...jobRetryFields(transformJobId(o.runId, o.sourceId, o.intensity)),
      estimatedCostUsd: o.estimatedCostUsd, status: o.status, timedOut: looksLikeTimeout(o.errorCode, o.errorMessage),
    })
  }

  for (const t of trials) {
    const cohortRow = cohortBySource.get(t.sourceId)
    const operation: OperationType = t.benchmarkCode === 'A2H-07' ? 'trial_a2h07' : t.benchmarkCode === 'A2H-11' ? 'trial_a2h11' : t.benchmarkCode === 'A2H-14' ? 'trial_a2h14' : 'trial_a2h15'
    const experimentalCode = EXPERIMENTAL_CODE_FOR_OPERATION[operation]
    records.push({
      operation, benchmarkCode: t.benchmarkCode, domainId: cohortRow?.domainId ?? null, targetWords: cohortRow?.targetWords ?? null,
      intensity: (t.condition['intensity'] as number | undefined) ?? null,
      requestedIntensity: (t.condition['requestedIntensity'] as number | undefined) ?? null,
      appliedIntensity: (t.condition['appliedIntensity'] as number | undefined) ?? null,
      intensityCapped: (t.condition['intensityCapped'] as boolean | undefined) ?? null,
      model: t.model, latencyMs: t.latencyMs,
      inputTokens: t.inputTokens, outputTokens: t.outputTokens, modelCalls: t.modelCalls,
      telemetryScope: 'primary_generation_only', pipelineRetryCount: t.retryCount,
      ...jobRetryFields(experimentalTrialJobId(t.runId, experimentalCode, t.sourceId, t.conditionId, t.trialIndex)),
      estimatedCostUsd: t.estimatedCostUsd, status: t.status === 'success' ? 'success' : 'failed', timedOut: looksLikeTimeout(t.errorCode, t.errorMessage),
    })
  }

  for (const r of repairAttempts) {
    const cohortRow = cohortBySource.get(r.sourceId)
    records.push({
      operation: 'repair', benchmarkCode: r.benchmarkCode, domainId: cohortRow?.domainId ?? null, targetWords: cohortRow?.targetWords ?? null,
      intensity: null, requestedIntensity: null, appliedIntensity: null, intensityCapped: null,
      model: r.model, latencyMs: r.latencyMs, inputTokens: r.inputTokens, outputTokens: r.outputTokens,
      modelCalls: r.modelCalls, telemetryScope: 'primary_generation_only', pipelineRetryCount: r.retryCount,
      ...jobRetryFields(run ? repairEvaluationJobId(r.runId, r.fixtureId, r.benchmarkCode, run.repairConfigVersion) : ''),
      estimatedCostUsd: r.estimatedCostUsd, status: r.status,
      timedOut: looksLikeTimeout(r.errorCode, r.errorMessage),
    })
  }

  return records
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

export async function getA2H17Report(firestore: Firestore, runId: string): Promise<A2H17Report> {
  const records = await collectOperationRecords(firestore, runId)
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

import type { Firestore } from 'firebase-admin/firestore'
import { A2H_COLLECTIONS, type A2HTestCode, type BenchmarkJob, type BenchmarkJobStage, type BenchmarkJobStatus, type BenchmarkRun, type BenchmarkOutput } from './types'
import { classifyFailure, nextRetryDelayMs } from './retryPolicy'
import { A2H01_CODE } from './a2h01'
import { A2H02_CODE } from './a2h02'
import { DETERMINISTIC_EVALUATORS } from './deterministicEvaluators'

const COLLECTION = A2H_COLLECTIONS.jobs

// A claimed job's lease lasts long enough to cover one worker invocation
// (the interactive /execute route and the optional manual worker route both
// set maxDuration=300) plus headroom for clock skew and a slow provider
// call — a lease that expired before the job actually finished would let a
// SECOND worker claim (and re-pay for) the same job while the first is
// still legitimately working. Centralized here (§5 of the Phase 5A spec) —
// no other module should hardcode its own timeout constant.
export const BENCHMARK_JOB_LEASE_MS = 10 * 60 * 1000
// Legacy alias — Phase 5 code referred to this constant by this name.
export const DEFAULT_LEASE_MS = BENCHMARK_JOB_LEASE_MS

// Deterministic ids per §10's logical keys — this is what makes enqueueing
// idempotent: calling getOrCreateJob twice with the same logical identity
// (whether from a genuine retry, a page refresh, or a resumed run) always
// resolves to the same Firestore document instead of creating a duplicate
// tracked (and potentially billable) work item.
function jobId(stage: BenchmarkJobStage, parts: (string | number)[]): string {
  return [stage, ...parts].join('__')
}

export function baselineJobId(runId: string, sourceId: string, detectorConfigId: string): string {
  return jobId('baseline_gptzero', [runId, sourceId, detectorConfigId])
}
export function transformJobId(runId: string, sourceId: string, intensity: number): string {
  return jobId('humanite_transform', [runId, sourceId, intensity])
}
export function postScoreJobId(runId: string, outputId: string, detectorConfigId: string): string {
  return jobId('post_gptzero', [runId, outputId, detectorConfigId])
}
export function testEvaluationJobId(runId: string, outputId: string, benchmarkCode: A2HTestCode, testVersion: string): string {
  return jobId('test_evaluation', [runId, outputId, benchmarkCode, testVersion])
}
// Keyed by fixture, not output (§23) — repairConfigVersion (not testVersion)
// disambiguates, matching BenchmarkRepairAttempt's own identity, since a
// repair_evaluation job's job is literally "produce/reuse that attempt and
// score it."
export function repairEvaluationJobId(runId: string, fixtureId: string, benchmarkCode: A2HTestCode, repairConfigVersion: string): string {
  return jobId('repair_evaluation', [runId, fixtureId, benchmarkCode, repairConfigVersion])
}
// Phase 4 (§36): identity is (run, benchmarkCode, source, condition, trial) —
// deliberately the SAME logical key trials.ts's trialId() uses, so a job and
// the trial it produces always share one identity.
export function experimentalTrialJobId(runId: string, benchmarkCode: A2HTestCode, sourceId: string, conditionId: string, trialIndex: number): string {
  return jobId('experimental_trial', [runId, benchmarkCode, sourceId, conditionId, trialIndex])
}

export interface CreateJobParams {
  id: string
  runId: string
  corpusProjectId: string
  stage: BenchmarkJobStage
  sourceId: string
  outputId?: string | null
  fixtureId?: string | null
  intensity?: number | null
  benchmarkCode?: A2HTestCode | null
  conditionId?: string | null
  trialIndex?: number | null
}

// Idempotent by construction: if a job with this exact id already exists
// (same logical identity), it's returned as-is rather than reset — a second
// call is a no-op precisely because the id already encodes "this is the same
// unit of work."
export async function getOrCreateJob(firestore: Firestore, params: CreateJobParams): Promise<BenchmarkJob> {
  const ref = firestore.collection(COLLECTION).doc(params.id)
  const existing = await ref.get()
  if (existing.exists) return existing.data() as BenchmarkJob

  const now = new Date().toISOString()
  const job: BenchmarkJob = {
    id: params.id,
    runId: params.runId,
    corpusProjectId: params.corpusProjectId,
    stage: params.stage,
    sourceId: params.sourceId,
    outputId: params.outputId ?? null,
    fixtureId: params.fixtureId ?? null,
    intensity: params.intensity ?? null,
    benchmarkCode: params.benchmarkCode ?? null,
    conditionId: params.conditionId ?? null,
    trialIndex: params.trialIndex ?? null,
    status: 'queued',
    attemptCount: 0,
    createdAt: now,
    startedAt: null,
    completedAt: null,
    errorCode: null,
    errorMessage: null,
    leaseOwner: null,
    leaseAcquiredAt: null,
    leaseExpiresAt: null,
    nextAttemptAt: null,
    lastHeartbeatAt: null,
    failureClass: null,
  }
  await ref.set(job)
  return job
}

export async function getJob(firestore: Firestore, id: string): Promise<BenchmarkJob | null> {
  const doc = await firestore.collection(COLLECTION).doc(id).get()
  return doc.exists ? (doc.data() as BenchmarkJob) : null
}

// Transactional queued/due-retry/stale-lease -> running+lease transition
// (Phase 5). Returns null when the job doesn't exist or isn't currently
// claimable — a caller that gets null should simply skip it rather than
// treating that as an error, since "another worker already claimed it a
// moment ago" is an expected, non-exceptional outcome of two workers
// (an interactive batch call and a cron tick, say) racing for the same job.
export async function claimJob(firestore: Firestore, id: string, workerId: string, leaseDurationMs = BENCHMARK_JOB_LEASE_MS): Promise<BenchmarkJob | null> {
  const ref = firestore.collection(COLLECTION).doc(id)
  return firestore.runTransaction(async tx => {
    const snap = await tx.get(ref)
    if (!snap.exists) return null
    const job = snap.data() as BenchmarkJob
    const now = Date.now()

    const retryDue = job.status === 'retrying' && (job.nextAttemptAt == null || new Date(job.nextAttemptAt).getTime() <= now)
    const leaseStale = job.status === 'running' && isJobStale(job, now)
    const claimable = job.status === 'queued' || retryDue || leaseStale
    if (!claimable) return null

    const nowIso = new Date(now).toISOString()
    const claimed: BenchmarkJob = {
      ...job,
      status: 'running',
      attemptCount: job.attemptCount + 1,
      startedAt: job.startedAt ?? nowIso,
      leaseOwner: workerId,
      leaseAcquiredAt: nowIso,
      leaseExpiresAt: new Date(now + leaseDurationMs).toISOString(),
      lastHeartbeatAt: nowIso,
      nextAttemptAt: null,
    }
    tx.set(ref, claimed)
    return claimed
  })
}

// §9 of the Phase 5A spec: a 'running' job is stale once its lease has
// expired — the worker that claimed it never reached markJobCompleted/
// markJobFailed (a crash, a killed request, a deploy mid-invocation, a
// closed browser tab). A legacy row from before leasing existed (no
// leaseExpiresAt at all) falls back to "has it been running longer than one
// lease duration" so old data doesn't get stuck 'running' forever either.
export function isJobStale(job: BenchmarkJob, now: number = Date.now()): boolean {
  if (job.status !== 'running') return false
  if (job.leaseExpiresAt != null) return new Date(job.leaseExpiresAt).getTime() < now
  if (job.startedAt != null) return now - new Date(job.startedAt).getTime() > BENCHMARK_JOB_LEASE_MS
  return false
}

// §8: extends a still-legitimately-running job's lease so a long operation
// doesn't get reclaimed out from under its own worker. Only succeeds if the
// job is still 'running' under the SAME leaseOwner that's calling — a caller
// whose lease already expired (and was possibly reclaimed by someone else)
// gets `false` back rather than resurrecting a lease it no longer legitimately
// holds. No stage's current operations approach the 10-minute lease window,
// so nothing calls this yet in practice — it exists as the primitive a future
// long-running stage would use, per the spec's "may initially occur only
// between major sub-steps" allowance.
export async function heartbeatJob(firestore: Firestore, id: string, leaseOwner: string, leaseDurationMs = BENCHMARK_JOB_LEASE_MS): Promise<boolean> {
  const ref = firestore.collection(COLLECTION).doc(id)
  return firestore.runTransaction(async tx => {
    const snap = await tx.get(ref)
    if (!snap.exists) return false
    const job = snap.data() as BenchmarkJob
    if (job.status !== 'running' || job.leaseOwner !== leaseOwner) return false
    const now = Date.now()
    tx.set(ref, { ...job, lastHeartbeatAt: new Date(now).toISOString(), leaseExpiresAt: new Date(now + leaseDurationMs).toISOString() })
    return true
  })
}

export async function markJobCompleted(firestore: Firestore, id: string): Promise<void> {
  await firestore.collection(COLLECTION).doc(id).update({
    status: 'completed' satisfies BenchmarkJobStatus,
    completedAt: new Date().toISOString(),
    errorCode: null,
    errorMessage: null,
    leaseOwner: null,
    leaseAcquiredAt: null,
    leaseExpiresAt: null,
    failureClass: null,
  })
}

// Classifies the failure (retryPolicy.ts) and either schedules a bounded
// backoff retry ('retrying', with nextAttemptAt) or terminates the job
// ('failed') — a permanent failure, or a retryable one that has exhausted
// BACKOFF_SCHEDULE_MS, is terminal either way. The lease is always released
// so a retried job is immediately claimable once its nextAttemptAt passes.
export async function markJobFailed(firestore: Firestore, id: string, err: unknown): Promise<void> {
  const job = await getJob(firestore, id)
  const errorCode = err instanceof Error ? err.constructor.name : 'UnknownError'
  const errorMessage = err instanceof Error ? err.message : 'Job failed.'
  const failureClass = classifyFailure(err)
  const attemptCount = job?.attemptCount ?? 1
  const delayMs = failureClass === 'retryable' ? nextRetryDelayMs(attemptCount) : null

  if (delayMs != null) {
    await firestore.collection(COLLECTION).doc(id).update({
      status: 'retrying' satisfies BenchmarkJobStatus,
      errorCode,
      errorMessage,
      failureClass,
      nextAttemptAt: new Date(Date.now() + delayMs).toISOString(),
      leaseOwner: null,
      leaseAcquiredAt: null,
      leaseExpiresAt: null,
    })
  } else {
    await firestore.collection(COLLECTION).doc(id).update({
      status: 'failed' satisfies BenchmarkJobStatus,
      // A terminally failed job's completedAt records WHEN it reached that
      // terminal state (§41's "last attempt" column) — a 'retrying' job
      // deliberately leaves completedAt untouched, since it isn't done yet.
      completedAt: new Date().toISOString(),
      errorCode,
      errorMessage,
      failureClass,
      leaseOwner: null,
      leaseAcquiredAt: null,
      leaseExpiresAt: null,
      nextAttemptAt: null,
    })
  }
}

// Resets one job back to 'queued' for a fresh attempt, clearing its lease/
// retry bookkeeping — used both by the bulk retryFailedJobs below and by
// recovery.ts's reconciliation-aware retry path (which calls this only for a
// failed job whose expected artifact does NOT already exist). Never touches
// attemptCount's cumulative history.
export async function resetJobForRetry(firestore: Firestore, id: string): Promise<void> {
  await firestore.collection(COLLECTION).doc(id).update({
    status: 'queued' satisfies BenchmarkJobStatus,
    errorCode: null,
    errorMessage: null,
    failureClass: null,
    nextAttemptAt: null,
    leaseOwner: null,
    leaseAcquiredAt: null,
    leaseExpiresAt: null,
  })
}

// Explicit admin action (§"Fix run completion semantics"): resets every
// 'failed' job in a run back to 'queued' for a fresh attempt. Blind — does
// NOT check whether the job's expected artifact already exists first; the
// admin-facing "Retry Failed Jobs" action goes through
// recovery.ts's reconcileAndRetryFailedJobs instead, which reconciles each
// failed job before deciding whether to reset it. This bulk version remains
// for simpler internal/test callers that don't need that reconciliation.
export async function retryFailedJobs(firestore: Firestore, runId: string): Promise<number> {
  const jobs = await listJobsForRun(firestore, runId)
  const failed = jobs.filter(j => j.status === 'failed')
  await Promise.all(failed.map(j => resetJobForRetry(firestore, j.id)))
  return failed.length
}

// The earliest nextAttemptAt among a run's currently-'retrying' jobs — lets
// executeRunBatch tell an idle caller (a UI poll loop, a manual worker
// invocation) when it's worth trying again, rather than the caller
// discovering "nothing to do" only by hammering the API repeatedly (§27).
export async function getEarliestNextAttempt(firestore: Firestore, runId: string): Promise<string | null> {
  const snap = await firestore.collection(COLLECTION).where('runId', '==', runId).where('status', '==', 'retrying').get()
  const dueTimes = snap.docs.map(d => d.data() as BenchmarkJob).map(j => j.nextAttemptAt).filter((t): t is string => t != null)
  if (dueTimes.length === 0) return null
  return dueTimes.reduce((min, t) => (t < min ? t : min), dueTimes[0]!)
}

// ── Workflow-graph helpers (§46) ─────────────────────────────────────────
//
// The same "create the next stage's job(s) for this unit of work" logic
// used both on the normal forward path (execution.ts's runBaselineJob/
// runPostScoreJob) AND by recovery.ts's reconciliation — recovery must
// repair the workflow graph, not merely flip one job's status, and reusing
// these exact functions is what guarantees the two paths can never drift
// out of sync with each other. Each is itself idempotent (getOrCreateJob),
// so calling one when the downstream job already exists is always a no-op.
export async function ensureTransformJobsForSource(firestore: Firestore, run: BenchmarkRun, sourceId: string): Promise<void> {
  await Promise.all(run.intensities.map(intensity => getOrCreateJob(firestore, {
    id: transformJobId(run.id, sourceId, intensity),
    runId: run.id,
    corpusProjectId: run.corpusProjectId,
    stage: 'humanite_transform',
    sourceId,
    intensity,
  })))
}

export async function ensurePostScoreJobForOutput(firestore: Firestore, run: BenchmarkRun, output: BenchmarkOutput, detectorConfigId: string): Promise<void> {
  await getOrCreateJob(firestore, {
    id: postScoreJobId(run.id, output.id, detectorConfigId),
    runId: run.id,
    corpusProjectId: run.corpusProjectId,
    stage: 'post_gptzero',
    sourceId: output.sourceId,
    outputId: output.id,
  })
}

export async function ensureTestEvaluationJobsForOutput(firestore: Firestore, run: BenchmarkRun, output: BenchmarkOutput): Promise<void> {
  const evaluableTests = run.enabledTests.filter(t => t === A2H01_CODE || t === A2H02_CODE || t in DETERMINISTIC_EVALUATORS)
  await Promise.all(evaluableTests.map(code => getOrCreateJob(firestore, {
    id: testEvaluationJobId(run.id, output.id, code, run.testVersion),
    runId: run.id,
    corpusProjectId: run.corpusProjectId,
    stage: 'test_evaluation',
    sourceId: output.sourceId,
    outputId: output.id,
    benchmarkCode: code,
  })))
}

export async function listJobsForRun(firestore: Firestore, runId: string): Promise<BenchmarkJob[]> {
  const snap = await firestore.collection(COLLECTION).where('runId', '==', runId).get()
  return snap.docs.map(d => d.data() as BenchmarkJob)
}

export async function listJobsByStageAndStatus(
  firestore: Firestore,
  runId: string,
  stage: BenchmarkJobStage,
  status: BenchmarkJobStatus,
): Promise<BenchmarkJob[]> {
  const snap = await firestore.collection(COLLECTION)
    .where('runId', '==', runId)
    .where('stage', '==', stage)
    .where('status', '==', status)
    .get()
  return snap.docs.map(d => d.data() as BenchmarkJob)
}

// Jobs in 'retrying' status whose backoff window has elapsed — a cheap
// equality-filtered query (status is indexed per stage/run already via
// listJobsByStageAndStatus's own composite index), filtered by nextAttemptAt
// in application code since Firestore can't combine an equality filter with
// a range comparison on a different field without a dedicated index.
export async function listDueRetryJobs(firestore: Firestore, runId: string, stage: BenchmarkJobStage): Promise<BenchmarkJob[]> {
  const snap = await firestore.collection(COLLECTION)
    .where('runId', '==', runId)
    .where('stage', '==', stage)
    .where('status', '==', 'retrying')
    .get()
  const now = Date.now()
  return snap.docs.map(d => d.data() as BenchmarkJob).filter(j => j.nextAttemptAt == null || new Date(j.nextAttemptAt).getTime() <= now)
}

// Marks every still-queued job for a run as cancelled — used by cancelRun
// (§11: "Cancel: mark unscheduled/queued work cancelled. Do not delete
// completed outputs/results."). Running/completed/failed jobs are left
// untouched; this deployment's synchronous, one-job-at-a-time execution
// model means there's never a job genuinely "in flight" when cancel is
// called from between two interactive batch calls.
export async function cancelQueuedJobs(firestore: Firestore, runId: string): Promise<number> {
  const jobs = await listJobsForRun(firestore, runId)
  const queued = jobs.filter(j => j.status === 'queued' || j.status === 'retrying')
  await Promise.all(queued.map(j => firestore.collection(COLLECTION).doc(j.id).update({ status: 'cancelled' satisfies BenchmarkJobStatus })))
  return queued.length
}

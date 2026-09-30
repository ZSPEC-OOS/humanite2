import type { Firestore } from 'firebase-admin/firestore'
import { A2H_COLLECTIONS, type A2HTestCode, type BenchmarkJob, type BenchmarkJobStage, type BenchmarkJobStatus } from './types'
import { classifyFailure, nextRetryDelayMs } from './retryPolicy'

const COLLECTION = A2H_COLLECTIONS.jobs

// A claimed job's lease lasts long enough to cover one worker invocation
// (the interactive /execute route and the cron worker both set
// maxDuration=300) plus headroom for clock skew and a slow provider call —
// a lease that expired before the job actually finished would let a SECOND
// worker claim (and re-pay for) the same job while the first is still
// legitimately working.
export const DEFAULT_LEASE_MS = 10 * 60 * 1000

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
export async function claimJob(firestore: Firestore, id: string, workerId: string, leaseDurationMs = DEFAULT_LEASE_MS): Promise<BenchmarkJob | null> {
  const ref = firestore.collection(COLLECTION).doc(id)
  return firestore.runTransaction(async tx => {
    const snap = await tx.get(ref)
    if (!snap.exists) return null
    const job = snap.data() as BenchmarkJob
    const now = Date.now()

    const retryDue = job.status === 'retrying' && (job.nextAttemptAt == null || new Date(job.nextAttemptAt).getTime() <= now)
    const leaseStale = job.status === 'running' && job.leaseExpiresAt != null && new Date(job.leaseExpiresAt).getTime() < now
    const claimable = job.status === 'queued' || retryDue || leaseStale
    if (!claimable) return null

    const nowIso = new Date(now).toISOString()
    const claimed: BenchmarkJob = {
      ...job,
      status: 'running',
      attemptCount: job.attemptCount + 1,
      startedAt: job.startedAt ?? nowIso,
      leaseOwner: workerId,
      leaseExpiresAt: new Date(now + leaseDurationMs).toISOString(),
      lastHeartbeatAt: nowIso,
      nextAttemptAt: null,
    }
    tx.set(ref, claimed)
    return claimed
  })
}

// Resets every 'running' job in a run whose lease has expired back to
// 'queued' — the worker that claimed it never reached markJobCompleted/
// markJobFailed (a crash, a killed request, a deploy mid-invocation). Run
// once per worker tick (not per stage, per job) since it's a maintenance
// sweep, not part of the normal claim path. Never touches attemptCount or
// clears the failure/retry history a job already has.
export async function reclaimStaleJobs(firestore: Firestore, runId: string): Promise<number> {
  const running = await firestore.collection(COLLECTION).where('runId', '==', runId).where('status', '==', 'running').get()
  const now = Date.now()
  const stale = running.docs
    .map(d => d.data() as BenchmarkJob)
    .filter(j => j.leaseExpiresAt != null && new Date(j.leaseExpiresAt).getTime() < now)
  await Promise.all(stale.map(j => firestore.collection(COLLECTION).doc(j.id).update({
    status: 'queued' satisfies BenchmarkJobStatus,
    leaseOwner: null,
    leaseExpiresAt: null,
  })))
  return stale.length
}

export async function markJobCompleted(firestore: Firestore, id: string): Promise<void> {
  await firestore.collection(COLLECTION).doc(id).update({
    status: 'completed' satisfies BenchmarkJobStatus,
    completedAt: new Date().toISOString(),
    errorCode: null,
    errorMessage: null,
    leaseOwner: null,
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
      leaseExpiresAt: null,
    })
  } else {
    await firestore.collection(COLLECTION).doc(id).update({
      status: 'failed' satisfies BenchmarkJobStatus,
      errorCode,
      errorMessage,
      failureClass,
      leaseOwner: null,
      leaseExpiresAt: null,
      nextAttemptAt: null,
    })
  }
}

// Explicit admin action (§"Fix run completion semantics"): resets every
// 'failed' job in a run back to 'queued' for a fresh attempt, clearing its
// failure/retry bookkeeping. Does not touch attemptCount's cumulative
// history — a job's failureClass/errorCode are cleared since they describe
// the attempt that's about to be superseded, not a permanent verdict.
export async function retryFailedJobs(firestore: Firestore, runId: string): Promise<number> {
  const jobs = await listJobsForRun(firestore, runId)
  const failed = jobs.filter(j => j.status === 'failed')
  await Promise.all(failed.map(j => firestore.collection(COLLECTION).doc(j.id).update({
    status: 'queued' satisfies BenchmarkJobStatus,
    errorCode: null,
    errorMessage: null,
    failureClass: null,
    nextAttemptAt: null,
    leaseOwner: null,
    leaseExpiresAt: null,
  })))
  return failed.length
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

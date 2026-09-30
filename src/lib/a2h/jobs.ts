import type { Firestore } from 'firebase-admin/firestore'
import { A2H_COLLECTIONS, type A2HTestCode, type BenchmarkJob, type BenchmarkJobStage, type BenchmarkJobStatus } from './types'

const COLLECTION = A2H_COLLECTIONS.jobs

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

export interface CreateJobParams {
  id: string
  runId: string
  corpusProjectId: string
  stage: BenchmarkJobStage
  sourceId: string
  outputId?: string | null
  intensity?: number | null
  benchmarkCode?: A2HTestCode | null
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
    intensity: params.intensity ?? null,
    benchmarkCode: params.benchmarkCode ?? null,
    status: 'queued',
    attemptCount: 0,
    createdAt: now,
    startedAt: null,
    completedAt: null,
    errorCode: null,
    errorMessage: null,
  }
  await ref.set(job)
  return job
}

export async function getJob(firestore: Firestore, id: string): Promise<BenchmarkJob | null> {
  const doc = await firestore.collection(COLLECTION).doc(id).get()
  return doc.exists ? (doc.data() as BenchmarkJob) : null
}

export async function markJobRunning(firestore: Firestore, id: string): Promise<void> {
  const job = await getJob(firestore, id)
  await firestore.collection(COLLECTION).doc(id).update({
    status: 'running' satisfies BenchmarkJobStatus,
    attemptCount: (job?.attemptCount ?? 0) + 1,
    startedAt: job?.startedAt ?? new Date().toISOString(),
  })
}

export async function markJobCompleted(firestore: Firestore, id: string): Promise<void> {
  await firestore.collection(COLLECTION).doc(id).update({
    status: 'completed' satisfies BenchmarkJobStatus,
    completedAt: new Date().toISOString(),
    errorCode: null,
    errorMessage: null,
  })
}

export async function markJobFailed(firestore: Firestore, id: string, errorCode: string, errorMessage: string): Promise<void> {
  await firestore.collection(COLLECTION).doc(id).update({
    status: 'failed' satisfies BenchmarkJobStatus,
    errorCode,
    errorMessage,
  })
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

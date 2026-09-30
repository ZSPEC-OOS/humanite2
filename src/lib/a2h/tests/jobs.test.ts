import { describe, it, expect } from 'vitest'
import type { Firestore } from 'firebase-admin/firestore'
import {
  baselineJobId, transformJobId, postScoreJobId, testEvaluationJobId,
  getOrCreateJob, getJob, claimJob, reclaimStaleJobs, markJobCompleted, markJobFailed, retryFailedJobs,
  listJobsForRun, listJobsByStageAndStatus, listDueRetryJobs, cancelQueuedJobs,
} from '../jobs'

function makeFirestore() {
  const docs = new Map<string, Record<string, unknown>>()

  function docRef(id: string) {
    return {
      id,
      get: async () => ({ exists: docs.has(id), data: () => docs.get(id) }),
      set: async (data: Record<string, unknown>) => { docs.set(id, data) },
      update: async (patch: Record<string, unknown>) => { docs.set(id, { ...(docs.get(id) ?? {}), ...patch }) },
    }
  }

  function makeQuery(predicate: (d: Record<string, unknown>) => boolean) {
    return {
      where: (field: string, _op: string, value: unknown) => makeQuery(d => predicate(d) && d[field] === value),
      get: async () => ({ docs: [...docs.values()].filter(predicate).map(data => ({ data: () => data })) }),
    }
  }

  const collection = {
    doc: (id: string) => docRef(id),
    where: (field: string, _op: string, value: unknown) => makeQuery(d => d[field] === value),
  }

  // A single-threaded transaction mock — no real isolation between
  // concurrent callers (vitest tests run sequentially anyway), but faithful
  // enough to exercise claimJob's own read-then-conditionally-write logic.
  const firestoreObj = {
    collection: () => collection,
    runTransaction: async <T>(fn: (tx: { get: (ref: ReturnType<typeof docRef>) => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>; set: (ref: ReturnType<typeof docRef>, data: Record<string, unknown>) => void }) => Promise<T>) => {
      const tx = {
        get: async (ref: ReturnType<typeof docRef>) => ref.get(),
        set: (ref: ReturnType<typeof docRef>, data: Record<string, unknown>) => { docs.set(ref.id, data) },
      }
      return fn(tx)
    },
  }
  return { firestore: firestoreObj as unknown as Firestore }
}

describe('job id builders', () => {
  it('are deterministic — the same logical key always produces the same id', () => {
    expect(baselineJobId('run-1', 'source-1', 'cfg')).toBe(baselineJobId('run-1', 'source-1', 'cfg'))
    expect(transformJobId('run-1', 'source-1', 5)).toBe(transformJobId('run-1', 'source-1', 5))
  })

  it('differ when any part of the logical key differs', () => {
    expect(baselineJobId('run-1', 'source-1', 'cfg')).not.toBe(baselineJobId('run-2', 'source-1', 'cfg'))
    expect(transformJobId('run-1', 'source-1', 5)).not.toBe(transformJobId('run-1', 'source-1', 6))
    expect(postScoreJobId('run-1', 'output-1', 'cfg')).not.toBe(postScoreJobId('run-1', 'output-2', 'cfg'))
    expect(testEvaluationJobId('run-1', 'output-1', 'A2H-01', 'v1')).not.toBe(testEvaluationJobId('run-1', 'output-1', 'A2H-02', 'v1'))
  })
})

describe('getOrCreateJob', () => {
  it('creates a new job in queued status with lease fields unset', async () => {
    const { firestore } = makeFirestore()
    const job = await getOrCreateJob(firestore, {
      id: baselineJobId('run-1', 'source-1', 'cfg'),
      runId: 'run-1', corpusProjectId: 'project-1', stage: 'baseline_gptzero', sourceId: 'source-1',
    })
    expect(job.status).toBe('queued')
    expect(job.attemptCount).toBe(0)
    expect(job.startedAt).toBeNull()
    expect(job.completedAt).toBeNull()
    expect(job.leaseOwner).toBeNull()
    expect(job.leaseExpiresAt).toBeNull()
    expect(job.failureClass).toBeNull()
  })

  it('is idempotent — calling it twice with the same id returns the same row rather than resetting it', async () => {
    const { firestore } = makeFirestore()
    const id = baselineJobId('run-1', 'source-1', 'cfg')
    const first = await getOrCreateJob(firestore, { id, runId: 'run-1', corpusProjectId: 'project-1', stage: 'baseline_gptzero', sourceId: 'source-1' })
    await markJobCompleted(firestore, id)
    const second = await getOrCreateJob(firestore, { id, runId: 'run-1', corpusProjectId: 'project-1', stage: 'baseline_gptzero', sourceId: 'source-1' })
    expect(second.status).toBe('completed')
    expect(second.id).toBe(first.id)
  })
})

describe('claimJob — transactional queued/retry-due/stale-lease claiming (Phase 5)', () => {
  it('claims a queued job, setting status=running, a lease, and incrementing attemptCount', async () => {
    const { firestore } = makeFirestore()
    const id = baselineJobId('run-1', 'source-1', 'cfg')
    await getOrCreateJob(firestore, { id, runId: 'run-1', corpusProjectId: 'project-1', stage: 'baseline_gptzero', sourceId: 'source-1' })

    const claimed = await claimJob(firestore, id, 'worker-a')
    expect(claimed?.status).toBe('running')
    expect(claimed?.attemptCount).toBe(1)
    expect(claimed?.leaseOwner).toBe('worker-a')
    expect(claimed?.leaseExpiresAt).not.toBeNull()
    expect(claimed?.startedAt).not.toBeNull()
  })

  it('a second worker cannot claim a job whose lease has not expired — prevents duplicate paid work', async () => {
    const { firestore } = makeFirestore()
    const id = baselineJobId('run-1', 'source-1', 'cfg')
    await getOrCreateJob(firestore, { id, runId: 'run-1', corpusProjectId: 'project-1', stage: 'baseline_gptzero', sourceId: 'source-1' })

    const first = await claimJob(firestore, id, 'worker-a')
    expect(first).not.toBeNull()
    const second = await claimJob(firestore, id, 'worker-b')
    expect(second).toBeNull()

    const job = await getJob(firestore, id)
    expect(job?.leaseOwner).toBe('worker-a')
  })

  it('a worker CAN reclaim a job whose lease has already expired', async () => {
    const { firestore } = makeFirestore()
    const id = baselineJobId('run-1', 'source-1', 'cfg')
    await getOrCreateJob(firestore, { id, runId: 'run-1', corpusProjectId: 'project-1', stage: 'baseline_gptzero', sourceId: 'source-1' })
    // Claim with an already-elapsed lease duration to simulate a stale lease.
    await claimJob(firestore, id, 'worker-a', -1)

    const reclaimed = await claimJob(firestore, id, 'worker-b')
    expect(reclaimed?.leaseOwner).toBe('worker-b')
    expect(reclaimed?.attemptCount).toBe(2)
  })

  it('cannot claim a completed or cancelled job', async () => {
    const { firestore } = makeFirestore()
    const id = baselineJobId('run-1', 'source-1', 'cfg')
    await getOrCreateJob(firestore, { id, runId: 'run-1', corpusProjectId: 'project-1', stage: 'baseline_gptzero', sourceId: 'source-1' })
    await markJobCompleted(firestore, id)
    expect(await claimJob(firestore, id, 'worker-a')).toBeNull()
  })

  it('claims a due retry but not one still in its backoff window', async () => {
    const { firestore } = makeFirestore()
    const id = baselineJobId('run-1', 'source-1', 'cfg')
    await getOrCreateJob(firestore, { id, runId: 'run-1', corpusProjectId: 'project-1', stage: 'baseline_gptzero', sourceId: 'source-1' })
    await firestore.collection('a2hBenchmarkJobs').doc(id).update({ status: 'retrying', nextAttemptAt: new Date(Date.now() + 60_000).toISOString() })
    expect(await claimJob(firestore, id, 'worker-a')).toBeNull()

    await firestore.collection('a2hBenchmarkJobs').doc(id).update({ nextAttemptAt: new Date(Date.now() - 1000).toISOString() })
    const claimed = await claimJob(firestore, id, 'worker-a')
    expect(claimed?.status).toBe('running')
  })

  it('returns null for a job that does not exist', async () => {
    const { firestore } = makeFirestore()
    expect(await claimJob(firestore, 'nonexistent', 'worker-a')).toBeNull()
  })
})

describe('reclaimStaleJobs', () => {
  it('resets a running job with an expired lease back to queued, leaving a fresh lease untouched', async () => {
    const { firestore } = makeFirestore()
    const staleId = baselineJobId('run-1', 's1', 'cfg')
    const freshId = baselineJobId('run-1', 's2', 'cfg')
    await getOrCreateJob(firestore, { id: staleId, runId: 'run-1', corpusProjectId: 'p1', stage: 'baseline_gptzero', sourceId: 's1' })
    await getOrCreateJob(firestore, { id: freshId, runId: 'run-1', corpusProjectId: 'p1', stage: 'baseline_gptzero', sourceId: 's2' })
    await claimJob(firestore, staleId, 'worker-a', -1)
    await claimJob(firestore, freshId, 'worker-b', 60_000)

    const reclaimedCount = await reclaimStaleJobs(firestore, 'run-1')
    expect(reclaimedCount).toBe(1)
    expect((await getJob(firestore, staleId))?.status).toBe('queued')
    expect((await getJob(firestore, staleId))?.leaseOwner).toBeNull()
    expect((await getJob(firestore, freshId))?.status).toBe('running')
  })
})

describe('markJobCompleted', () => {
  it('sets status and completedAt, clearing any prior error and lease', async () => {
    const { firestore } = makeFirestore()
    const id = baselineJobId('run-1', 'source-1', 'cfg')
    await getOrCreateJob(firestore, { id, runId: 'run-1', corpusProjectId: 'project-1', stage: 'baseline_gptzero', sourceId: 'source-1' })
    await claimJob(firestore, id, 'worker-a')
    await markJobFailed(firestore, id, new Error('boom'))
    await markJobCompleted(firestore, id)
    const job = await getJob(firestore, id)
    expect(job?.status).toBe('completed')
    expect(job?.completedAt).not.toBeNull()
    expect(job?.errorCode).toBeNull()
    expect(job?.errorMessage).toBeNull()
    expect(job?.leaseOwner).toBeNull()
  })
})

describe('markJobFailed — retry classification and bounded backoff (Phase 5)', () => {
  class RateLimitError extends Error {}
  class ValidationBug extends Error {}

  it('a retryable failure on the first attempt becomes "retrying" with a scheduled nextAttemptAt', async () => {
    const { firestore } = makeFirestore()
    const id = baselineJobId('run-1', 'source-1', 'cfg')
    await getOrCreateJob(firestore, { id, runId: 'run-1', corpusProjectId: 'project-1', stage: 'baseline_gptzero', sourceId: 'source-1' })
    await claimJob(firestore, id, 'worker-a') // attemptCount -> 1

    await markJobFailed(firestore, id, new RateLimitError('rate limit exceeded'))
    const job = await getJob(firestore, id)
    expect(job?.status).toBe('retrying')
    expect(job?.failureClass).toBe('retryable')
    expect(job?.nextAttemptAt).not.toBeNull()
    expect(job?.leaseOwner).toBeNull()
  })

  it('a permanent failure goes straight to "failed", never "retrying"', async () => {
    const { firestore } = makeFirestore()
    const id = baselineJobId('run-1', 'source-1', 'cfg')
    await getOrCreateJob(firestore, { id, runId: 'run-1', corpusProjectId: 'project-1', stage: 'baseline_gptzero', sourceId: 'source-1' })
    await claimJob(firestore, id, 'worker-a')

    await markJobFailed(firestore, id, new ValidationBug('Source not found.'))
    const job = await getJob(firestore, id)
    expect(job?.status).toBe('failed')
    expect(job?.failureClass).toBe('permanent')
    expect(job?.nextAttemptAt).toBeNull()
  })

  it('a retryable failure that exhausts the backoff schedule becomes permanently failed', async () => {
    const { firestore } = makeFirestore()
    const id = baselineJobId('run-1', 'source-1', 'cfg')
    await getOrCreateJob(firestore, { id, runId: 'run-1', corpusProjectId: 'project-1', stage: 'baseline_gptzero', sourceId: 'source-1' })

    // Simulate one failure beyond the full 3-entry backoff schedule (4
    // total retryable failures) — the 4th must exhaust the schedule and
    // terminate the job rather than scheduling a 4th retry.
    for (let i = 0; i < 4; i++) {
      await firestore.collection('a2hBenchmarkJobs').doc(id).update({ nextAttemptAt: new Date(Date.now() - 1000).toISOString() })
      const claimed = await claimJob(firestore, id, 'worker-a')
      expect(claimed).not.toBeNull()
      await markJobFailed(firestore, id, new RateLimitError('rate limit'))
    }
    const job = await getJob(firestore, id)
    expect(job?.status).toBe('failed')
    expect(job?.attemptCount).toBe(4)
  })

  it('falls back to UnknownError for a non-Error throw', async () => {
    const { firestore } = makeFirestore()
    const id = baselineJobId('run-1', 'source-1', 'cfg')
    await getOrCreateJob(firestore, { id, runId: 'run-1', corpusProjectId: 'project-1', stage: 'baseline_gptzero', sourceId: 'source-1' })
    await claimJob(firestore, id, 'worker-a')
    await markJobFailed(firestore, id, 'a plain string throw')
    const job = await getJob(firestore, id)
    expect(job?.errorCode).toBe('UnknownError')
    expect(job?.failureClass).toBe('permanent')
  })
})

describe('retryFailedJobs — explicit admin action', () => {
  it('resets every failed job in a run back to queued, clearing its failure bookkeeping', async () => {
    const { firestore } = makeFirestore()
    const failedId = baselineJobId('run-1', 's1', 'cfg')
    const completedId = baselineJobId('run-1', 's2', 'cfg')
    await getOrCreateJob(firestore, { id: failedId, runId: 'run-1', corpusProjectId: 'p1', stage: 'baseline_gptzero', sourceId: 's1' })
    await getOrCreateJob(firestore, { id: completedId, runId: 'run-1', corpusProjectId: 'p1', stage: 'baseline_gptzero', sourceId: 's2' })
    await claimJob(firestore, failedId, 'worker-a')
    await markJobFailed(firestore, failedId, new Error('permanent-ish'))
    await markJobCompleted(firestore, completedId)

    const count = await retryFailedJobs(firestore, 'run-1')
    expect(count).toBe(1)
    const retried = await getJob(firestore, failedId)
    expect(retried?.status).toBe('queued')
    expect(retried?.errorCode).toBeNull()
    expect(retried?.failureClass).toBeNull()
    expect((await getJob(firestore, completedId))?.status).toBe('completed')
  })
})

describe('listDueRetryJobs', () => {
  it('returns only retrying jobs whose nextAttemptAt has passed', async () => {
    const { firestore } = makeFirestore()
    const dueId = baselineJobId('run-1', 's1', 'cfg')
    const notDueId = baselineJobId('run-1', 's2', 'cfg')
    await getOrCreateJob(firestore, { id: dueId, runId: 'run-1', corpusProjectId: 'p1', stage: 'baseline_gptzero', sourceId: 's1' })
    await getOrCreateJob(firestore, { id: notDueId, runId: 'run-1', corpusProjectId: 'p1', stage: 'baseline_gptzero', sourceId: 's2' })
    await firestore.collection('a2hBenchmarkJobs').doc(dueId).update({ status: 'retrying', nextAttemptAt: new Date(Date.now() - 1000).toISOString() })
    await firestore.collection('a2hBenchmarkJobs').doc(notDueId).update({ status: 'retrying', nextAttemptAt: new Date(Date.now() + 60_000).toISOString() })

    const due = await listDueRetryJobs(firestore, 'run-1', 'baseline_gptzero')
    expect(due.map(j => j.id)).toEqual([dueId])
  })
})

describe('listJobsForRun / listJobsByStageAndStatus', () => {
  it('filters correctly by run, stage, and status', async () => {
    const { firestore } = makeFirestore()
    await getOrCreateJob(firestore, { id: baselineJobId('run-1', 's1', 'cfg'), runId: 'run-1', corpusProjectId: 'p1', stage: 'baseline_gptzero', sourceId: 's1' })
    await getOrCreateJob(firestore, { id: baselineJobId('run-1', 's2', 'cfg'), runId: 'run-1', corpusProjectId: 'p1', stage: 'baseline_gptzero', sourceId: 's2' })
    await getOrCreateJob(firestore, { id: transformJobId('run-1', 's1', 5), runId: 'run-1', corpusProjectId: 'p1', stage: 'humanite_transform', sourceId: 's1', intensity: 5 })
    await getOrCreateJob(firestore, { id: baselineJobId('run-2', 's1', 'cfg'), runId: 'run-2', corpusProjectId: 'p1', stage: 'baseline_gptzero', sourceId: 's1' })

    expect(await listJobsForRun(firestore, 'run-1')).toHaveLength(3)
    expect(await listJobsForRun(firestore, 'run-2')).toHaveLength(1)
    expect(await listJobsByStageAndStatus(firestore, 'run-1', 'baseline_gptzero', 'queued')).toHaveLength(2)
    expect(await listJobsByStageAndStatus(firestore, 'run-1', 'humanite_transform', 'queued')).toHaveLength(1)
  })
})

describe('cancelQueuedJobs', () => {
  it('cancels only queued/retrying jobs, leaving completed ones untouched (§11)', async () => {
    const { firestore } = makeFirestore()
    const completedId = baselineJobId('run-1', 's1', 'cfg')
    const queuedId = baselineJobId('run-1', 's2', 'cfg')
    await getOrCreateJob(firestore, { id: completedId, runId: 'run-1', corpusProjectId: 'p1', stage: 'baseline_gptzero', sourceId: 's1' })
    await markJobCompleted(firestore, completedId)
    await getOrCreateJob(firestore, { id: queuedId, runId: 'run-1', corpusProjectId: 'p1', stage: 'baseline_gptzero', sourceId: 's2' })

    const cancelledCount = await cancelQueuedJobs(firestore, 'run-1')
    expect(cancelledCount).toBe(1)
    expect((await getJob(firestore, completedId))?.status).toBe('completed')
    expect((await getJob(firestore, queuedId))?.status).toBe('cancelled')
  })
})

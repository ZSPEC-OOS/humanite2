import { describe, it, expect } from 'vitest'
import type { Firestore } from 'firebase-admin/firestore'
import {
  baselineJobId, transformJobId, postScoreJobId, testEvaluationJobId,
  getOrCreateJob, getJob, markJobRunning, markJobCompleted, markJobFailed,
  listJobsForRun, listJobsByStageAndStatus, cancelQueuedJobs,
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
  return { firestore: { collection: () => collection } as unknown as Firestore }
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
  it('creates a new job in queued status', async () => {
    const { firestore } = makeFirestore()
    const job = await getOrCreateJob(firestore, {
      id: baselineJobId('run-1', 'source-1', 'cfg'),
      runId: 'run-1', corpusProjectId: 'project-1', stage: 'baseline_gptzero', sourceId: 'source-1',
    })
    expect(job.status).toBe('queued')
    expect(job.attemptCount).toBe(0)
    expect(job.startedAt).toBeNull()
    expect(job.completedAt).toBeNull()
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

describe('job status transitions', () => {
  it('markJobRunning increments attemptCount and sets startedAt once', async () => {
    const { firestore } = makeFirestore()
    const id = baselineJobId('run-1', 'source-1', 'cfg')
    await getOrCreateJob(firestore, { id, runId: 'run-1', corpusProjectId: 'project-1', stage: 'baseline_gptzero', sourceId: 'source-1' })

    await markJobRunning(firestore, id)
    const afterFirst = await getJob(firestore, id)
    expect(afterFirst?.status).toBe('running')
    expect(afterFirst?.attemptCount).toBe(1)
    expect(afterFirst?.startedAt).not.toBeNull()

    const startedAt = afterFirst!.startedAt
    await markJobRunning(firestore, id)
    const afterSecond = await getJob(firestore, id)
    expect(afterSecond?.attemptCount).toBe(2)
    expect(afterSecond?.startedAt).toBe(startedAt)
  })

  it('markJobCompleted sets status and completedAt, clearing any prior error', async () => {
    const { firestore } = makeFirestore()
    const id = baselineJobId('run-1', 'source-1', 'cfg')
    await getOrCreateJob(firestore, { id, runId: 'run-1', corpusProjectId: 'project-1', stage: 'baseline_gptzero', sourceId: 'source-1' })
    await markJobFailed(firestore, id, 'Boom', 'it broke')
    await markJobCompleted(firestore, id)
    const job = await getJob(firestore, id)
    expect(job?.status).toBe('completed')
    expect(job?.completedAt).not.toBeNull()
    expect(job?.errorCode).toBeNull()
    expect(job?.errorMessage).toBeNull()
  })

  it('markJobFailed records the error', async () => {
    const { firestore } = makeFirestore()
    const id = baselineJobId('run-1', 'source-1', 'cfg')
    await getOrCreateJob(firestore, { id, runId: 'run-1', corpusProjectId: 'project-1', stage: 'baseline_gptzero', sourceId: 'source-1' })
    await markJobFailed(firestore, id, 'ProviderError', 'GPTZero timed out')
    const job = await getJob(firestore, id)
    expect(job?.status).toBe('failed')
    expect(job?.errorCode).toBe('ProviderError')
    expect(job?.errorMessage).toBe('GPTZero timed out')
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

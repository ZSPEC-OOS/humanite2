import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { HumanizeAPIResponse, JobStatus } from '@/lib/api'

const { apiHumanizeMock, apiGetJobMock } = vi.hoisted(() => ({
  apiHumanizeMock: vi.fn(),
  apiGetJobMock: vi.fn(),
}))

vi.mock('@/lib/api', () => ({
  apiHumanize: apiHumanizeMock,
  apiGetJob: apiGetJobMock,
}))

const { useHumanizeStore } = await import('../humanizeStore')

function pendingResponse(): HumanizeAPIResponse {
  return {
    job_id: 'job-1', status: 'pending', output: null,
    preprocessing_metadata: null, intensity: null, processing_metadata: null,
    result_url: null, warning: null,
  }
}

function completedJob(): JobStatus {
  return {
    job_id: 'job-1', job_type: 'humanize', status: 'completed', created_at: '', completed_at: null,
    result_url: null, error_code: null, processing_metadata: null, progress: null, partial_output: null,
    output: {
      text: 'a long-finished result that should never reach the screen',
      detection: null, detection_warning: null,
      watermark: { type: 'sha256', fingerprint: 'f', job_id: 'job-1', model: 'm', verification_url: '', issued_at: '' },
      postprocessor_substitutions: 0,
    } as unknown as JobStatus['output'],
  }
}

// Stale-write-guard regression test (deep-audit finding): without
// activeGeneration, a reset() that fires while humanize() is still polling
// an async job does NOT stop the poll loop, and its eventual completion
// later overwrites whatever the user is now looking at.
describe('useHumanizeStore — stale-write guard (activeGeneration)', () => {
  beforeEach(() => {
    apiHumanizeMock.mockReset()
    apiGetJobMock.mockReset()
    useHumanizeStore.setState({ response: null, status: 'idle', error: null, progressMessage: null })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('reset() during a pending async poll prevents the later completion from landing', async () => {
    vi.useFakeTimers()
    apiHumanizeMock.mockResolvedValue(pendingResponse())
    let resolveJob!: (job: JobStatus) => void
    apiGetJobMock.mockImplementation(() => new Promise<JobStatus>(resolve => { resolveJob = resolve }))

    const promise = useHumanizeStore.getState().humanize('a long document')
    await vi.advanceTimersByTimeAsync(3_000) // let the poll loop's sleep() fire, reaching the in-flight apiGetJob call

    // User clicks "Clear" while the job is still being polled.
    useHumanizeStore.getState().reset()
    expect(useHumanizeStore.getState().status).toBe('idle')

    // The original job NOW finishes — this must not resurrect the cleared state.
    resolveJob(completedJob())
    await promise

    expect(useHumanizeStore.getState().status).toBe('idle')
    expect(useHumanizeStore.getState().response).toBeNull()
  })

  it('a SECOND humanize() call supersedes the first — the first call\'s late result is discarded', async () => {
    vi.useFakeTimers()
    apiHumanizeMock
      .mockResolvedValueOnce(pendingResponse())
      .mockResolvedValueOnce({ ...pendingResponse(), job_id: 'job-2' })

    let resolveFirstJob!: (job: JobStatus) => void
    apiGetJobMock.mockImplementation((jobId: string) => {
      if (jobId === 'job-1') return new Promise<JobStatus>(resolve => { resolveFirstJob = resolve })
      return Promise.resolve({ ...completedJob(), job_id: 'job-2' })
    })

    const firstCall = useHumanizeStore.getState().humanize('first document')
    await vi.advanceTimersByTimeAsync(3_000)

    // User starts a brand-new humanize before the first one's job resolves.
    const secondCall = useHumanizeStore.getState().humanize('second document')
    await vi.advanceTimersByTimeAsync(3_000)
    await secondCall
    expect(useHumanizeStore.getState().response?.job_id).toBe('job-2')

    // The FIRST call's job now (belatedly) completes — must not overwrite job-2's result.
    resolveFirstJob(completedJob())
    await firstCall
    expect(useHumanizeStore.getState().response?.job_id).toBe('job-2')
  })

  it('normal completion (no reset) still applies the result', async () => {
    apiHumanizeMock.mockResolvedValue({ ...pendingResponse() })
    apiGetJobMock.mockResolvedValue(completedJob())

    vi.useFakeTimers()
    const promise = useHumanizeStore.getState().humanize('a document')
    await vi.advanceTimersByTimeAsync(3_000)
    await promise

    expect(useHumanizeStore.getState().status).toBe('done')
    expect(useHumanizeStore.getState().response?.job_id).toBe('job-1')
  })
})

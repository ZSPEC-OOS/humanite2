import { describe, it, expect, vi, beforeEach } from 'vitest'

const { jobStore, dbShouldThrow, getShouldReject } = vi.hoisted(() => ({
  jobStore: new Map<string, Record<string, unknown>>(),
  dbShouldThrow: { value: false },
  getShouldReject: { value: false },
}))

vi.mock('@/lib/firestore', () => ({
  db: () => {
    if (dbShouldThrow.value) throw new Error('Missing Firebase credentials')
    return {
      collection: () => ({
        doc: (id: string) => ({
          get: async () => {
            if (getShouldReject.value) throw new Error('Firestore unavailable')
            const data = jobStore.get(id)
            return { exists: !!data, data: () => data }
          },
        }),
      }),
    }
  },
}))

const { resolveVerification } = await import('../exportVerification')
const { hashContent } = await import('../watermark')

function completedAtStub(iso: string) {
  return { toDate: () => new Date(iso) }
}

beforeEach(() => {
  jobStore.clear()
  dbShouldThrow.value = false
  getShouldReject.value = false
})

describe('resolveVerification', () => {
  it('returns null when no job_id was given at all', async () => {
    expect(await resolveVerification(undefined, 'user-1', 'some text')).toBeNull()
  })

  it('returns null when the job does not exist', async () => {
    expect(await resolveVerification('missing-job', 'user-1', 'some text')).toBeNull()
  })

  it('returns null when the job belongs to a different user — the ownership check', async () => {
    const text = 'The exact output text.'
    jobStore.set('job-1', {
      userId: 'someone-else',
      watermarkFingerprint: 'abc123',
      contentHash: hashContent(text),
      completedAt: completedAtStub('2024-01-01T00:00:00Z'),
    })
    expect(await resolveVerification('job-1', 'user-1', text)).toBeNull()
  })

  it('returns null when the submitted text does not match the job\'s stored contentHash — the actual bypass this closes', async () => {
    jobStore.set('job-1', {
      userId: 'user-1',
      watermarkFingerprint: 'abc123',
      contentHash: hashContent('The real output text.'),
      completedAt: completedAtStub('2024-01-01T00:00:00Z'),
    })
    // Same job, same owner, but different (e.g. client-tampered) text.
    expect(await resolveVerification('job-1', 'user-1', 'A completely different claim.')).toBeNull()
  })

  it('returns null for a job completed before contentHash/watermarkFingerprint existed', async () => {
    jobStore.set('job-1', { userId: 'user-1', completedAt: completedAtStub('2023-01-01T00:00:00Z') })
    expect(await resolveVerification('job-1', 'user-1', 'anything')).toBeNull()
  })

  it('returns the fingerprint and issuedAt when ownership and content hash both match', async () => {
    const text = 'The exact output text.'
    jobStore.set('job-1', {
      userId: 'user-1',
      watermarkFingerprint: 'fp-abc123',
      contentHash: hashContent(text),
      completedAt: completedAtStub('2024-06-01T12:00:00.000Z'),
    })
    const result = await resolveVerification('job-1', 'user-1', text)
    expect(result).toEqual({ fingerprint: 'fp-abc123', issuedAt: '2024-06-01T12:00:00.000Z' })
  })

  it('never derives the fingerprint from anything but the stored job record', async () => {
    // Nothing in the function signature even accepts a client-supplied
    // fingerprint — this test just documents that constraint explicitly.
    const text = 'text'
    jobStore.set('job-1', {
      userId: 'user-1',
      watermarkFingerprint: 'server-issued-fp',
      contentHash: hashContent(text),
      completedAt: completedAtStub('2024-01-01T00:00:00Z'),
    })
    const result = await resolveVerification('job-1', 'user-1', text)
    expect(result?.fingerprint).toBe('server-issued-fp')
  })

  it('fails safe (returns null, does not throw) when db() itself throws synchronously', async () => {
    dbShouldThrow.value = true
    await expect(resolveVerification('job-1', 'user-1', 'text')).resolves.toBeNull()
  })

  it('fails safe (returns null, does not throw) when the Firestore lookup rejects', async () => {
    getShouldReject.value = true
    await expect(resolveVerification('job-1', 'user-1', 'text')).resolves.toBeNull()
  })
})

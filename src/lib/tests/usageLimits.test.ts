import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { docStore, txShouldThrow } = vi.hoisted(() => ({
  docStore: new Map<string, { requests: number; words: number }>(),
  txShouldThrow: { value: false },
}))

vi.mock('@/lib/firestore', () => ({
  db: () => ({
    collection: () => ({
      doc: (key: string) => ({ __key: key }),
    }),
    runTransaction: async (
      fn: (tx: {
        get: (ref: { __key: string }) => Promise<{ exists: boolean; data: () => unknown }>
        set: (ref: { __key: string }, value: unknown, opts?: { merge?: boolean }) => void
      }) => Promise<unknown>,
    ) => {
      if (txShouldThrow.value) throw new Error('Firestore unavailable')
      const tx = {
        get: async (ref: { __key: string }) => ({
          exists: docStore.has(ref.__key),
          data: () => docStore.get(ref.__key),
        }),
        set: (ref: { __key: string }, value: unknown) => {
          docStore.set(ref.__key, value as { requests: number; words: number })
        },
      }
      return fn(tx)
    },
  }),
}))

const { checkAndRecordUsage } = await import('../usageLimits')

const ORIGINAL_ENV = { ...process.env }

function resetEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key]
  }
  Object.assign(process.env, ORIGINAL_ENV)
}

beforeEach(() => {
  docStore.clear()
  txShouldThrow.value = false
  resetEnv()
})
afterEach(resetEnv)

describe('checkAndRecordUsage', () => {
  it('allows a first request well under budget', async () => {
    const result = await checkAndRecordUsage('user-1', 'free', 100)
    expect(result.allowed).toBe(true)
  })

  it('blocks once the daily request count is exhausted', async () => {
    process.env.FREE_TIER_REQUESTS_PER_DAY = '2'
    process.env.FREE_TIER_WORDS_PER_DAY = '1000000'
    expect((await checkAndRecordUsage('user-1', 'free', 10)).allowed).toBe(true)
    expect((await checkAndRecordUsage('user-1', 'free', 10)).allowed).toBe(true)
    const third = await checkAndRecordUsage('user-1', 'free', 10)
    expect(third.allowed).toBe(false)
    expect(third.reason).toMatch(/daily request limit/i)
  })

  it('blocks once the daily word budget is exhausted, even under the request-count cap', async () => {
    process.env.FREE_TIER_REQUESTS_PER_DAY = '1000'
    process.env.FREE_TIER_WORDS_PER_DAY = '500'
    expect((await checkAndRecordUsage('user-1', 'free', 300)).allowed).toBe(true)
    const second = await checkAndRecordUsage('user-1', 'free', 300)
    expect(second.allowed).toBe(false)
    expect(second.reason).toMatch(/daily word limit/i)
  })

  it('a request that would exceed the word budget does not get partially recorded', async () => {
    process.env.FREE_TIER_REQUESTS_PER_DAY = '1000'
    process.env.FREE_TIER_WORDS_PER_DAY = '500'
    await checkAndRecordUsage('user-1', 'free', 300)
    const rejected = await checkAndRecordUsage('user-1', 'free', 300) // would total 600 > 500
    expect(rejected.allowed).toBe(false)
    // A later, smaller request that fits in the remaining budget must still succeed —
    // proving the rejected request's words were never added to the running total.
    const stillFits = await checkAndRecordUsage('user-1', 'free', 150) // 300 + 150 = 450 <= 500
    expect(stillFits.allowed).toBe(true)
  })

  it('tracks separate users independently', async () => {
    process.env.FREE_TIER_REQUESTS_PER_DAY = '1'
    expect((await checkAndRecordUsage('user-a', 'free', 10)).allowed).toBe(true)
    expect((await checkAndRecordUsage('user-a', 'free', 10)).allowed).toBe(false)
    // A different user's budget is untouched by user-a's usage.
    expect((await checkAndRecordUsage('user-b', 'free', 10)).allowed).toBe(true)
  })

  it('applies a higher limit for the pro tier than free', async () => {
    process.env.FREE_TIER_REQUESTS_PER_DAY = '1'
    process.env.PRO_TIER_REQUESTS_PER_DAY = '5'
    expect((await checkAndRecordUsage('pro-user', 'pro', 10)).allowed).toBe(true)
    expect((await checkAndRecordUsage('pro-user', 'pro', 10)).allowed).toBe(true)
    // Would already be blocked at free's limit of 1, but pro's limit is 5.
    expect((await checkAndRecordUsage('pro-user', 'pro', 10)).allowed).toBe(true)
  })

  it('treats an unrecognized tier as free rather than granting unlimited use', async () => {
    process.env.FREE_TIER_REQUESTS_PER_DAY = '1'
    expect((await checkAndRecordUsage('user-x', 'not-a-real-tier', 10)).allowed).toBe(true)
    expect((await checkAndRecordUsage('user-x', 'not-a-real-tier', 10)).allowed).toBe(false)
  })

  it('fails open (allows the request) if Firestore itself is unavailable', async () => {
    txShouldThrow.value = true
    const result = await checkAndRecordUsage('user-1', 'free', 10)
    expect(result.allowed).toBe(true)
  })
})

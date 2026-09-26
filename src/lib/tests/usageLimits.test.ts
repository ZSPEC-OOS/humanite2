import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { docStore, txShouldThrow, dbShouldThrow } = vi.hoisted(() => ({
  docStore: new Map<string, Record<string, number>>(),
  txShouldThrow: { value: false },
  dbShouldThrow: { value: false },
}))

vi.mock('@/lib/firestore', () => ({
  db: () => {
    // Mirrors the real db() throwing synchronously when Firebase
    // credentials are missing — a regression test for a real bug: the
    // collection().doc() call that builds a doc reference used to happen
    // before the try/catch, so this exact failure mode wasn't actually
    // caught despite the "fails open" doc comment above.
    if (dbShouldThrow.value) throw new Error('Missing Firebase credentials')
    return {
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
          set: (ref: { __key: string }, value: unknown, opts?: { merge?: boolean }) => {
            const existing = opts?.merge ? (docStore.get(ref.__key) ?? {}) : {}
            docStore.set(ref.__key, { ...existing, ...(value as Record<string, number>) })
          },
        }
        return fn(tx)
      },
    }
  },
}))

const { checkAndRecordGenerationUsage, checkAndRecordScanUsage } = await import('../usageLimits')

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
  dbShouldThrow.value = false
  resetEnv()
})
afterEach(resetEnv)

describe('checkAndRecordGenerationUsage', () => {
  it('allows a first request well under budget', async () => {
    const result = await checkAndRecordGenerationUsage('user-1', 'free', 100)
    expect(result.allowed).toBe(true)
  })

  it('blocks once the daily request count is exhausted', async () => {
    process.env.FREE_TIER_GENERATION_REQUESTS_PER_DAY = '2'
    process.env.FREE_TIER_GENERATION_WORDS_PER_DAY = '1000000'
    expect((await checkAndRecordGenerationUsage('user-1', 'free', 10)).allowed).toBe(true)
    expect((await checkAndRecordGenerationUsage('user-1', 'free', 10)).allowed).toBe(true)
    const third = await checkAndRecordGenerationUsage('user-1', 'free', 10)
    expect(third.allowed).toBe(false)
    expect(third.code).toBe('LIMIT_EXCEEDED')
    expect(third.reason).toMatch(/daily generation request limit/i)
  })

  it('blocks once the daily word budget is exhausted, even under the request-count cap', async () => {
    process.env.FREE_TIER_GENERATION_REQUESTS_PER_DAY = '1000'
    process.env.FREE_TIER_GENERATION_WORDS_PER_DAY = '500'
    expect((await checkAndRecordGenerationUsage('user-1', 'free', 300)).allowed).toBe(true)
    const second = await checkAndRecordGenerationUsage('user-1', 'free', 300)
    expect(second.allowed).toBe(false)
    expect(second.reason).toMatch(/daily generation word limit/i)
  })

  it('a request that would exceed the word budget does not get partially recorded', async () => {
    process.env.FREE_TIER_GENERATION_REQUESTS_PER_DAY = '1000'
    process.env.FREE_TIER_GENERATION_WORDS_PER_DAY = '500'
    await checkAndRecordGenerationUsage('user-1', 'free', 300)
    const rejected = await checkAndRecordGenerationUsage('user-1', 'free', 300) // would total 600 > 500
    expect(rejected.allowed).toBe(false)
    // A later, smaller request that fits in the remaining budget must still succeed —
    // proving the rejected request's words were never added to the running total.
    const stillFits = await checkAndRecordGenerationUsage('user-1', 'free', 150) // 300 + 150 = 450 <= 500
    expect(stillFits.allowed).toBe(true)
  })

  it('tracks separate users independently', async () => {
    process.env.FREE_TIER_GENERATION_REQUESTS_PER_DAY = '1'
    expect((await checkAndRecordGenerationUsage('user-a', 'free', 10)).allowed).toBe(true)
    expect((await checkAndRecordGenerationUsage('user-a', 'free', 10)).allowed).toBe(false)
    // A different user's budget is untouched by user-a's usage.
    expect((await checkAndRecordGenerationUsage('user-b', 'free', 10)).allowed).toBe(true)
  })

  it('applies a higher limit for the pro tier than free', async () => {
    process.env.FREE_TIER_GENERATION_REQUESTS_PER_DAY = '1'
    process.env.PRO_TIER_GENERATION_REQUESTS_PER_DAY = '5'
    expect((await checkAndRecordGenerationUsage('pro-user', 'pro', 10)).allowed).toBe(true)
    expect((await checkAndRecordGenerationUsage('pro-user', 'pro', 10)).allowed).toBe(true)
    // Would already be blocked at free's limit of 1, but pro's limit is 5.
    expect((await checkAndRecordGenerationUsage('pro-user', 'pro', 10)).allowed).toBe(true)
  })

  it('treats an unrecognized tier as free rather than granting unlimited use', async () => {
    process.env.FREE_TIER_GENERATION_REQUESTS_PER_DAY = '1'
    expect((await checkAndRecordGenerationUsage('user-x', 'not-a-real-tier', 10)).allowed).toBe(true)
    expect((await checkAndRecordGenerationUsage('user-x', 'not-a-real-tier', 10)).allowed).toBe(false)
  })

  it('fails closed (rejects the request) if the transaction itself fails', async () => {
    // This function is only ever invoked on the server-funded key path (see
    // the call-site guards in humanize/route.ts and scan/route.ts) — failing
    // open here would mean a Firestore outage removes all spend protection
    // on keys this deployment pays for, so it must not default to "allowed".
    txShouldThrow.value = true
    const result = await checkAndRecordGenerationUsage('user-1', 'free', 10)
    expect(result.allowed).toBe(false)
    expect(result.code).toBe('UNAVAILABLE')
  })

  it('fails closed even when db() itself throws synchronously (e.g. missing Firebase credentials)', async () => {
    // The doc reference is built inside the try/catch specifically so this
    // failure mode (db() throwing before any Firestore call is even
    // attempted) is caught the same way a rejected transaction is.
    dbShouldThrow.value = true
    const result = await checkAndRecordGenerationUsage('user-1', 'free', 10)
    expect(result.allowed).toBe(false)
    expect(result.code).toBe('UNAVAILABLE')
  })

  it('bypasses the quota entirely for an allowlisted email hash, without touching Firestore', async () => {
    process.env.FREE_TIER_GENERATION_REQUESTS_PER_DAY = '1'
    process.env.FREE_TIER_GENERATION_WORDS_PER_DAY = '1'
    process.env.UNLIMITED_USAGE_EMAIL_HASHES = 'admin-hash-1,admin-hash-2'
    const result = await checkAndRecordGenerationUsage('user-1', 'free', 999999, 'admin-hash-2')
    expect(result.allowed).toBe(true)
    expect(docStore.size).toBe(0)
    // A second call for the same allowlisted account is unaffected by the
    // (never-recorded) usage from the first.
    expect((await checkAndRecordGenerationUsage('user-1', 'free', 999999, 'admin-hash-2')).allowed).toBe(true)
  })

  it('does not bypass the quota for a non-allowlisted email hash', async () => {
    process.env.FREE_TIER_GENERATION_REQUESTS_PER_DAY = '1000'
    process.env.FREE_TIER_GENERATION_WORDS_PER_DAY = '1'
    process.env.UNLIMITED_USAGE_EMAIL_HASHES = 'admin-hash-1'
    const result = await checkAndRecordGenerationUsage('user-1', 'free', 10, 'some-other-hash')
    expect(result.allowed).toBe(false)
    expect(result.code).toBe('LIMIT_EXCEEDED')
  })
})

describe('checkAndRecordScanUsage', () => {
  it('is gated out entirely on a plan with zero scan quota', async () => {
    // Every tier now ships a real (non-zero) scan quota by default — this
    // test exercises the zero-quota gate itself, not any particular tier's
    // current numbers, so it forces zero explicitly via env override rather
    // than relying on a tier that happens to default to it.
    process.env.FREE_TIER_SCAN_REQUESTS_PER_DAY = '0'
    process.env.FREE_TIER_SCAN_WORDS_PER_DAY = '0'
    const result = await checkAndRecordScanUsage('user-1', 'free', 10)
    expect(result.allowed).toBe(false)
    expect(result.code).toBe('LIMIT_EXCEEDED')
    expect(result.reason).toMatch(/isn.t included in your plan/i)
    // Zero quota is a feature gate, not a budget to exhaust — it must not
    // touch Firestore (no doc should get created for a plan that can't scan
    // at all).
    expect(docStore.size).toBe(0)
  })

  it('allows scanning on a plan with real scan quota', async () => {
    process.env.PRO_TIER_SCAN_REQUESTS_PER_DAY = '10'
    process.env.PRO_TIER_SCAN_WORDS_PER_DAY = '1000'
    const result = await checkAndRecordScanUsage('pro-user', 'pro', 500)
    expect(result.allowed).toBe(true)
  })

  it('blocks once the scan word budget is exhausted', async () => {
    process.env.PRO_TIER_SCAN_REQUESTS_PER_DAY = '10'
    process.env.PRO_TIER_SCAN_WORDS_PER_DAY = '1000'
    expect((await checkAndRecordScanUsage('pro-user', 'pro', 700)).allowed).toBe(true)
    const second = await checkAndRecordScanUsage('pro-user', 'pro', 700)
    expect(second.allowed).toBe(false)
    expect(second.reason).toMatch(/daily scan word limit/i)
  })

  it('tracks generation and scan as fully independent pools for the same user', async () => {
    process.env.PRO_TIER_GENERATION_REQUESTS_PER_DAY = '1'
    process.env.PRO_TIER_GENERATION_WORDS_PER_DAY = '10'
    process.env.PRO_TIER_SCAN_REQUESTS_PER_DAY = '1'
    process.env.PRO_TIER_SCAN_WORDS_PER_DAY = '10'

    // Exhaust generation entirely.
    expect((await checkAndRecordGenerationUsage('pro-user', 'pro', 10)).allowed).toBe(true)
    expect((await checkAndRecordGenerationUsage('pro-user', 'pro', 1)).allowed).toBe(false)

    // Scan budget is untouched by generation usage above.
    expect((await checkAndRecordScanUsage('pro-user', 'pro', 10)).allowed).toBe(true)
    expect((await checkAndRecordScanUsage('pro-user', 'pro', 1)).allowed).toBe(false)
  })

  it('fails closed if the transaction itself fails', async () => {
    process.env.PRO_TIER_SCAN_REQUESTS_PER_DAY = '10'
    process.env.PRO_TIER_SCAN_WORDS_PER_DAY = '1000'
    txShouldThrow.value = true
    const result = await checkAndRecordScanUsage('pro-user', 'pro', 10)
    expect(result.allowed).toBe(false)
    expect(result.code).toBe('UNAVAILABLE')
  })
})

describe('gold tier — unrestricted access (no daily limits, no quotas, no feature gates)', () => {
  it('is never blocked by the daily generation request limit, however low', async () => {
    process.env.FREE_TIER_GENERATION_REQUESTS_PER_DAY = '1'
    process.env.FREE_TIER_GENERATION_WORDS_PER_DAY = '1'
    for (let i = 0; i < 5; i++) {
      expect((await checkAndRecordGenerationUsage('gold-user', 'gold', 10)).allowed).toBe(true)
    }
  })

  it('is never blocked by the daily generation word limit, even for a huge submission', async () => {
    process.env.FREE_TIER_GENERATION_WORDS_PER_DAY = '1'
    const result = await checkAndRecordGenerationUsage('gold-user', 'gold', 10_000_000)
    expect(result.allowed).toBe(true)
  })

  it('is never blocked by the daily scan request or word limit', async () => {
    process.env.FREE_TIER_SCAN_REQUESTS_PER_DAY = '1'
    process.env.FREE_TIER_SCAN_WORDS_PER_DAY = '1'
    for (let i = 0; i < 5; i++) {
      expect((await checkAndRecordScanUsage('gold-user', 'gold', 10_000)).allowed).toBe(true)
    }
  })

  it('bypasses even a zero-quota feature gate — scanning stays available where a Free-tier plan would have it disabled entirely', async () => {
    process.env.FREE_TIER_SCAN_REQUESTS_PER_DAY = '0'
    process.env.FREE_TIER_SCAN_WORDS_PER_DAY = '0'
    // A Free-tier account is correctly gated out (regression guard for the
    // behavior this test is contrasting against).
    const free = await checkAndRecordScanUsage('free-user', 'free', 10)
    expect(free.allowed).toBe(false)
    expect(free.reason).toMatch(/isn.t included in your plan/i)

    const gold = await checkAndRecordScanUsage('gold-user', 'gold', 10)
    expect(gold.allowed).toBe(true)
  })

  it('never touches Firestore — no usage document is written for a Gold account', async () => {
    process.env.FREE_TIER_GENERATION_REQUESTS_PER_DAY = '1'
    await checkAndRecordGenerationUsage('gold-user', 'gold', 999_999)
    await checkAndRecordScanUsage('gold-user', 'gold', 999_999)
    expect(docStore.size).toBe(0)
  })

  it('is independent of the separate email-hash allowlist mechanism — bypass works with no email hash at all', async () => {
    process.env.FREE_TIER_GENERATION_REQUESTS_PER_DAY = '1'
    const result = await checkAndRecordGenerationUsage('gold-user', 'gold', 100, '')
    expect(result.allowed).toBe(true)
  })

  it('leaves Free-tier restrictions completely unchanged', async () => {
    process.env.FREE_TIER_GENERATION_REQUESTS_PER_DAY = '1'
    process.env.FREE_TIER_GENERATION_WORDS_PER_DAY = '1000000'
    expect((await checkAndRecordGenerationUsage('free-user', 'free', 10)).allowed).toBe(true)
    const second = await checkAndRecordGenerationUsage('free-user', 'free', 10)
    expect(second.allowed).toBe(false)
    expect(second.code).toBe('LIMIT_EXCEEDED')
  })
})

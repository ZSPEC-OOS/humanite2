import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { docStore, txShouldThrow, dbShouldThrow } = vi.hoisted(() => ({
  docStore: new Map<string, Record<string, number | string>>(),
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
      // Incorporates the collection name into the stored key so
      // usage_monthly/usage_trial/usage_daily (real, distinct collections in
      // production) can never share state in this mock even if their doc
      // ids ever happened to collide in format — a regression guard for a
      // test-fidelity gap, not a production behavior.
      collection: (name: string) => ({
        doc: (key: string) => ({
          __key: `${name}/${key}`,
          // getUsageSummary reads a doc directly (no transaction) — the
          // recording path above never needs this, only tx.get() below.
          get: async () => ({
            exists: docStore.has(`${name}/${key}`),
            data: () => docStore.get(`${name}/${key}`),
          }),
        }),
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

const { checkAndRecordGenerationUsage, checkAndRecordScanUsage, getUsageSummary } = await import('../usageLimits')

const ORIGINAL_ENV = { ...process.env }

function resetEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key]
  }
  Object.assign(process.env, ORIGINAL_ENV)
}

// A fixed "account created" timestamp well within any Free trial window —
// every Free-tier call in this file that isn't specifically testing trial
// EXPIRATION passes this, via vi.setSystemTime pinning "now" close to it.
const RECENT_SIGNUP = '2026-10-01T00:00:00.000Z'

beforeEach(() => {
  docStore.clear()
  txShouldThrow.value = false
  dbShouldThrow.value = false
  resetEnv()
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-05T00:00:00.000Z')) // 4 days into the trial, well before expiry
})
afterEach(() => {
  resetEnv()
  vi.useRealTimers()
})

describe('checkAndRecordGenerationUsage', () => {
  it('allows a first request well under budget', async () => {
    const result = await checkAndRecordGenerationUsage('user-1', 'free', 100, '', RECENT_SIGNUP)
    expect(result.allowed).toBe(true)
  })

  it('blocks once the daily request-rate ceiling is exhausted (abuse backstop, not the trial word quota)', async () => {
    process.env.FREE_TIER_GENERATION_REQUESTS_PER_DAY = '2'
    process.env.FREE_TRIAL_GENERATION_WORDS_TOTAL = '1000000'
    expect((await checkAndRecordGenerationUsage('user-1', 'free', 10, '', RECENT_SIGNUP)).allowed).toBe(true)
    expect((await checkAndRecordGenerationUsage('user-1', 'free', 10, '', RECENT_SIGNUP)).allowed).toBe(true)
    const third = await checkAndRecordGenerationUsage('user-1', 'free', 10, '', RECENT_SIGNUP)
    expect(third.allowed).toBe(false)
    expect(third.code).toBe('LIMIT_EXCEEDED')
    expect(third.reason).toMatch(/daily generation request limit/i)
  })

  it('blocks once the monthly word budget is exhausted for a recurring (paid) tier, even under the daily request-rate ceiling', async () => {
    process.env.STARTER_TIER_GENERATION_REQUESTS_PER_DAY = '1000'
    process.env.STARTER_TIER_GENERATION_WORDS_PER_MONTH = '500'
    expect((await checkAndRecordGenerationUsage('user-1', 'starter', 300)).allowed).toBe(true)
    const second = await checkAndRecordGenerationUsage('user-1', 'starter', 300)
    expect(second.allowed).toBe(false)
    expect(second.reason).toMatch(/monthly generated-word allowance/i)
  })

  it('a request that would exceed the monthly word budget does not get partially recorded', async () => {
    process.env.STARTER_TIER_GENERATION_REQUESTS_PER_DAY = '1000'
    process.env.STARTER_TIER_GENERATION_WORDS_PER_MONTH = '500'
    await checkAndRecordGenerationUsage('user-1', 'starter', 300)
    const rejected = await checkAndRecordGenerationUsage('user-1', 'starter', 300) // would total 600 > 500
    expect(rejected.allowed).toBe(false)
    // A later, smaller request that fits in the remaining budget must still succeed —
    // proving the rejected request's words were never added to the running total.
    const stillFits = await checkAndRecordGenerationUsage('user-1', 'starter', 150) // 300 + 150 = 450 <= 500
    expect(stillFits.allowed).toBe(true)
  })

  it('tracks separate users independently', async () => {
    process.env.FREE_TIER_GENERATION_REQUESTS_PER_DAY = '1'
    expect((await checkAndRecordGenerationUsage('user-a', 'free', 10, '', RECENT_SIGNUP)).allowed).toBe(true)
    expect((await checkAndRecordGenerationUsage('user-a', 'free', 10, '', RECENT_SIGNUP)).allowed).toBe(false)
    // A different user's budget is untouched by user-a's usage.
    expect((await checkAndRecordGenerationUsage('user-b', 'free', 10, '', RECENT_SIGNUP)).allowed).toBe(true)
  })

  it('applies a higher limit for the starter tier than free, and higher still for pro', async () => {
    process.env.FREE_TIER_GENERATION_REQUESTS_PER_DAY = '1'
    process.env.STARTER_TIER_GENERATION_REQUESTS_PER_DAY = '3'
    process.env.PRO_TIER_GENERATION_REQUESTS_PER_DAY = '5'
    expect((await checkAndRecordGenerationUsage('starter-user', 'starter', 10)).allowed).toBe(true)
    expect((await checkAndRecordGenerationUsage('starter-user', 'starter', 10)).allowed).toBe(true)
    expect((await checkAndRecordGenerationUsage('starter-user', 'starter', 10)).allowed).toBe(true)
    // Would already be blocked at free's limit of 1, but starter's limit is 3.
    expect((await checkAndRecordGenerationUsage('starter-user', 'starter', 10)).allowed).toBe(false)

    expect((await checkAndRecordGenerationUsage('pro-user', 'pro', 10)).allowed).toBe(true)
    expect((await checkAndRecordGenerationUsage('pro-user', 'pro', 10)).allowed).toBe(true)
    expect((await checkAndRecordGenerationUsage('pro-user', 'pro', 10)).allowed).toBe(true)
  })

  it('treats an unrecognized tier as free (trial semantics) rather than granting unlimited use', async () => {
    process.env.FREE_TIER_GENERATION_REQUESTS_PER_DAY = '1'
    expect((await checkAndRecordGenerationUsage('user-x', 'not-a-real-tier', 10, '', RECENT_SIGNUP)).allowed).toBe(true)
    expect((await checkAndRecordGenerationUsage('user-x', 'not-a-real-tier', 10, '', RECENT_SIGNUP)).allowed).toBe(false)
  })

  it("'starter' never silently falls through to the free trial quota", async () => {
    process.env.FREE_TRIAL_GENERATION_WORDS_TOTAL = '1'
    process.env.STARTER_TIER_GENERATION_WORDS_PER_MONTH = '100000'
    const result = await checkAndRecordGenerationUsage('starter-user', 'starter', 50_000)
    expect(result.allowed).toBe(true)
  })

  it('fails closed (rejects the request) if the transaction itself fails', async () => {
    // This function is only ever invoked on the server-funded key path (see
    // the call-site guards in humanize/route.ts and scan/route.ts) — failing
    // open here would mean a Firestore outage removes all spend protection
    // on keys this deployment pays for, so it must not default to "allowed".
    txShouldThrow.value = true
    const result = await checkAndRecordGenerationUsage('user-1', 'free', 10, '', RECENT_SIGNUP)
    expect(result.allowed).toBe(false)
    expect(result.code).toBe('UNAVAILABLE')
  })

  it('fails closed even when db() itself throws synchronously (e.g. missing Firebase credentials)', async () => {
    // The doc references are built inside the try/catch specifically so this
    // failure mode (db() throwing before any Firestore call is even
    // attempted) is caught the same way a rejected transaction is.
    dbShouldThrow.value = true
    const result = await checkAndRecordGenerationUsage('user-1', 'free', 10, '', RECENT_SIGNUP)
    expect(result.allowed).toBe(false)
    expect(result.code).toBe('UNAVAILABLE')
  })

  it('bypasses the quota entirely for an allowlisted email hash, without touching Firestore', async () => {
    process.env.FREE_TIER_GENERATION_REQUESTS_PER_DAY = '1'
    process.env.FREE_TRIAL_GENERATION_WORDS_TOTAL = '1'
    process.env.UNLIMITED_USAGE_EMAIL_HASHES = 'admin-hash-1,admin-hash-2'
    const result = await checkAndRecordGenerationUsage('user-1', 'free', 999999, 'admin-hash-2', RECENT_SIGNUP)
    expect(result.allowed).toBe(true)
    expect(docStore.size).toBe(0)
    // A second call for the same allowlisted account is unaffected by the
    // (never-recorded) usage from the first.
    expect((await checkAndRecordGenerationUsage('user-1', 'free', 999999, 'admin-hash-2', RECENT_SIGNUP)).allowed).toBe(true)
  })

  it('does not bypass the quota for a non-allowlisted email hash', async () => {
    process.env.FREE_TIER_GENERATION_REQUESTS_PER_DAY = '1000'
    process.env.FREE_TRIAL_GENERATION_WORDS_TOTAL = '1'
    process.env.UNLIMITED_USAGE_EMAIL_HASHES = 'admin-hash-1'
    const result = await checkAndRecordGenerationUsage('user-1', 'free', 10, 'some-other-hash', RECENT_SIGNUP)
    expect(result.allowed).toBe(false)
    expect(result.code).toBe('LIMIT_EXCEEDED')
  })

  it('names the next tier up and its allowance when a monthly quota is exhausted, never suggesting a tier above Max', async () => {
    process.env.STARTER_TIER_GENERATION_WORDS_PER_MONTH = '100'
    const starter = await checkAndRecordGenerationUsage('starter-user', 'starter', 200)
    expect(starter.reason).toMatch(/upgrade to pro/i)
    expect(starter.reason).toMatch(/100,000/)

    process.env.ENTERPRISE_TIER_GENERATION_WORDS_PER_MONTH = '100'
    const max = await checkAndRecordGenerationUsage('max-user', 'enterprise', 200)
    expect(max.reason).not.toMatch(/upgrade/i)
  })
})

describe('checkAndRecordScanUsage', () => {
  it('is gated out entirely on a plan with zero scan quota', async () => {
    // Every tier now ships a real (non-zero) scan quota by default — this
    // test exercises the zero-quota gate itself, not any particular tier's
    // current numbers, so it forces zero explicitly via env override rather
    // than relying on a tier that happens to default to it.
    process.env.FREE_TIER_SCAN_REQUESTS_PER_DAY = '0'
    process.env.FREE_TRIAL_SCAN_WORDS_TOTAL = '0'
    const result = await checkAndRecordScanUsage('user-1', 'free', 10, '', RECENT_SIGNUP)
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
    process.env.PRO_TIER_SCAN_WORDS_PER_MONTH = '1000'
    const result = await checkAndRecordScanUsage('pro-user', 'pro', 500)
    expect(result.allowed).toBe(true)
  })

  it('blocks once the monthly scan word budget is exhausted', async () => {
    process.env.PRO_TIER_SCAN_REQUESTS_PER_DAY = '10'
    process.env.PRO_TIER_SCAN_WORDS_PER_MONTH = '1000'
    expect((await checkAndRecordScanUsage('pro-user', 'pro', 700)).allowed).toBe(true)
    const second = await checkAndRecordScanUsage('pro-user', 'pro', 700)
    expect(second.allowed).toBe(false)
    expect(second.reason).toMatch(/monthly scanned-word allowance/i)
  })

  it('tracks generation and scan as fully independent pools for the same user', async () => {
    process.env.PRO_TIER_GENERATION_REQUESTS_PER_DAY = '1'
    process.env.PRO_TIER_GENERATION_WORDS_PER_MONTH = '10'
    process.env.PRO_TIER_SCAN_REQUESTS_PER_DAY = '1'
    process.env.PRO_TIER_SCAN_WORDS_PER_MONTH = '10'

    // Exhaust generation entirely.
    expect((await checkAndRecordGenerationUsage('pro-user', 'pro', 10)).allowed).toBe(true)
    expect((await checkAndRecordGenerationUsage('pro-user', 'pro', 1)).allowed).toBe(false)

    // Scan budget is untouched by generation usage above.
    expect((await checkAndRecordScanUsage('pro-user', 'pro', 10)).allowed).toBe(true)
    expect((await checkAndRecordScanUsage('pro-user', 'pro', 1)).allowed).toBe(false)
  })

  it('fails closed if the transaction itself fails', async () => {
    process.env.PRO_TIER_SCAN_REQUESTS_PER_DAY = '10'
    process.env.PRO_TIER_SCAN_WORDS_PER_MONTH = '1000'
    txShouldThrow.value = true
    const result = await checkAndRecordScanUsage('pro-user', 'pro', 10)
    expect(result.allowed).toBe(false)
    expect(result.code).toBe('UNAVAILABLE')
  })
})

// Starter/Pro/Max's advertised quota is MONTHLY, not daily — a user must be
// able to spend their allowance unevenly across the month (heavy on day 1,
// nothing for weeks) and still be under budget, which a daily word cap could
// never express. These tests pin that behavior down directly against the
// real system clock via vi.setSystemTime. (Free is NOT a monthly tier
// anymore — see "Free trial semantics" below for its own accounting model.)
describe('monthly accounting semantics (recurring paid tiers)', () => {
  it('allows usage spread unevenly across a month, up to the monthly cap, denying only once truly exhausted', async () => {
    process.env.STARTER_TIER_GENERATION_REQUESTS_PER_DAY = '1000'
    process.env.STARTER_TIER_GENERATION_WORDS_PER_MONTH = '5000'

    vi.setSystemTime(new Date('2026-10-01T00:00:00.000Z'))
    expect((await checkAndRecordGenerationUsage('user-1', 'starter', 4000)).allowed).toBe(true)

    vi.setSystemTime(new Date('2026-10-20T00:00:00.000Z'))
    expect((await checkAndRecordGenerationUsage('user-1', 'starter', 1000)).allowed).toBe(true) // 4000 + 1000 = 5000, exactly at cap

    vi.setSystemTime(new Date('2026-10-25T00:00:00.000Z'))
    const overBudget = await checkAndRecordGenerationUsage('user-1', 'starter', 1)
    expect(overBudget.allowed).toBe(false)
    expect(overBudget.code).toBe('LIMIT_EXCEEDED')
  })

  it('resets automatically at the start of the next calendar month, with no manual cleanup', async () => {
    process.env.STARTER_TIER_GENERATION_REQUESTS_PER_DAY = '1000'
    process.env.STARTER_TIER_GENERATION_WORDS_PER_MONTH = '5000'

    vi.setSystemTime(new Date('2026-10-25T00:00:00.000Z'))
    expect((await checkAndRecordGenerationUsage('user-1', 'starter', 5000)).allowed).toBe(true)
    expect((await checkAndRecordGenerationUsage('user-1', 'starter', 1)).allowed).toBe(false) // exhausted for October

    vi.setSystemTime(new Date('2026-11-01T00:00:00.000Z'))
    const nextMonth = await checkAndRecordGenerationUsage('user-1', 'starter', 5000)
    expect(nextMonth.allowed).toBe(true) // a brand-new period key, no manual reset needed
  })

  it('still enforces the DAILY request-rate ceiling independently of the monthly word reset', async () => {
    process.env.STARTER_TIER_GENERATION_REQUESTS_PER_DAY = '2'
    process.env.STARTER_TIER_GENERATION_WORDS_PER_MONTH = '1000000'

    vi.setSystemTime(new Date('2026-10-15T00:00:00.000Z'))
    expect((await checkAndRecordGenerationUsage('user-1', 'starter', 10)).allowed).toBe(true)
    expect((await checkAndRecordGenerationUsage('user-1', 'starter', 10)).allowed).toBe(true)
    expect((await checkAndRecordGenerationUsage('user-1', 'starter', 10)).allowed).toBe(false) // daily ceiling hit, same day

    vi.setSystemTime(new Date('2026-10-16T00:00:00.000Z'))
    expect((await checkAndRecordGenerationUsage('user-1', 'starter', 10)).allowed).toBe(true) // new day, request-rate pool reset
  })
})

// Free is a one-time, 30-day trial: a lifetime word allowance per pool that
// never resets, PLUS a hard cutoff once the trial window has elapsed,
// independent of how much of the word allowance remains unused.
describe('Free trial semantics (30-day lifetime quota + expiration)', () => {
  it('accumulates usage across days WITHOUT resetting — unlike the monthly pool, there is no period key', async () => {
    process.env.FREE_TRIAL_GENERATION_WORDS_TOTAL = '1200'
    process.env.FREE_TIER_GENERATION_REQUESTS_PER_DAY = '1000'

    vi.setSystemTime(new Date('2026-10-01T00:00:00.000Z'))
    expect((await checkAndRecordGenerationUsage('user-1', 'free', 700, '', '2026-09-20T00:00:00.000Z')).allowed).toBe(true)

    // A week later, STILL within the trial — the 700 already spent must
    // still count against the SAME lifetime total (not reset by the new day
    // the way a monthly tier resets by new month).
    vi.setSystemTime(new Date('2026-10-08T00:00:00.000Z'))
    const stillCounts = await checkAndRecordGenerationUsage('user-1', 'free', 500, '', '2026-09-20T00:00:00.000Z')
    expect(stillCounts.allowed).toBe(true) // 700 + 500 = 1200, exactly at the lifetime cap

    const exhausted = await checkAndRecordGenerationUsage('user-1', 'free', 1, '', '2026-09-20T00:00:00.000Z')
    expect(exhausted.allowed).toBe(false)
    expect(exhausted.reason).toMatch(/used your free trial's 1,200 generated words/i)
  })

  it('names Starter and its recurring allowance when the trial\'s lifetime quota is exhausted', async () => {
    process.env.FREE_TRIAL_GENERATION_WORDS_TOTAL = '100'
    const result = await checkAndRecordGenerationUsage('user-1', 'free', 200, '', RECENT_SIGNUP)
    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/upgrade to starter/i)
    expect(result.reason).toMatch(/50,000/)
  })

  it('blocks ALL further usage once 30 days have passed since account creation, even with quota untouched', async () => {
    const signedUpAt = '2026-01-01T00:00:00.000Z'
    vi.setSystemTime(new Date('2026-02-01T00:00:00.001Z')) // 31 days later
    const result = await checkAndRecordGenerationUsage('user-1', 'free', 1, '', signedUpAt)
    expect(result.allowed).toBe(false)
    expect(result.code).toBe('LIMIT_EXCEEDED')
    expect(result.reason).toMatch(/30-day free trial has ended/i)
    expect(result.reason).toMatch(/upgrade to starter/i)
    // Expiration is checked BEFORE any Firestore read/write — no usage doc
    // should exist for a request the trial-expiration gate already rejected.
    expect(docStore.size).toBe(0)
  })

  it('still allows usage on exactly day 30 (inclusive) and blocks starting day 31', async () => {
    const signedUpAt = '2026-01-01T00:00:00.000Z'

    vi.setSystemTime(new Date('2026-01-30T23:59:00.000Z')) // just under 30 days
    expect((await checkAndRecordGenerationUsage('user-1', 'free', 1, '', signedUpAt)).allowed).toBe(true)

    vi.setSystemTime(new Date('2026-01-31T00:00:01.000Z')) // just over 30 days
    expect((await checkAndRecordGenerationUsage('user-1', 'free', 1, '', signedUpAt)).allowed).toBe(false)
  })

  it('respects a custom FREE_TRIAL_DAYS override', async () => {
    process.env.FREE_TRIAL_DAYS = '7'
    const signedUpAt = '2026-01-01T00:00:00.000Z'
    vi.setSystemTime(new Date('2026-01-09T00:00:00.000Z')) // 8 days later — past a 7-day trial
    const result = await checkAndRecordGenerationUsage('user-1', 'free', 1, '', signedUpAt)
    expect(result.allowed).toBe(false)
    expect(result.reason).toMatch(/7-day free trial has ended/i)
  })

  it('fails open on expiration specifically (does not block) when accountCreatedAt is missing/unparsable — the word/request quotas still apply', async () => {
    const withMissingClaim = await checkAndRecordGenerationUsage('user-1', 'free', 100, '', '')
    expect(withMissingClaim.allowed).toBe(true)

    const withGarbageClaim = await checkAndRecordGenerationUsage('user-2', 'free', 100, '', 'not-a-real-date')
    expect(withGarbageClaim.allowed).toBe(true)
  })

  it('tracks generation and scan as independent lifetime pools', async () => {
    process.env.FREE_TRIAL_GENERATION_WORDS_TOTAL = '10'
    process.env.FREE_TRIAL_SCAN_WORDS_TOTAL = '10'
    expect((await checkAndRecordGenerationUsage('user-1', 'free', 10, '', RECENT_SIGNUP)).allowed).toBe(true)
    expect((await checkAndRecordGenerationUsage('user-1', 'free', 1, '', RECENT_SIGNUP)).allowed).toBe(false)
    // Scan's own lifetime pool is untouched by generation usage above.
    expect((await checkAndRecordScanUsage('user-1', 'free', 10, '', RECENT_SIGNUP)).allowed).toBe(true)
  })
})

describe('gold tier — unrestricted access (no daily limits, no quotas, no feature gates)', () => {
  it('is never blocked by the daily generation request limit, however low', async () => {
    process.env.FREE_TIER_GENERATION_REQUESTS_PER_DAY = '1'
    process.env.FREE_TRIAL_GENERATION_WORDS_TOTAL = '1'
    for (let i = 0; i < 5; i++) {
      expect((await checkAndRecordGenerationUsage('gold-user', 'gold', 10)).allowed).toBe(true)
    }
  })

  it('is never blocked by a word limit, even for a huge submission', async () => {
    process.env.FREE_TRIAL_GENERATION_WORDS_TOTAL = '1'
    const result = await checkAndRecordGenerationUsage('gold-user', 'gold', 10_000_000)
    expect(result.allowed).toBe(true)
  })

  it('is never blocked by the daily scan request or word limit', async () => {
    process.env.FREE_TIER_SCAN_REQUESTS_PER_DAY = '1'
    process.env.FREE_TRIAL_SCAN_WORDS_TOTAL = '1'
    for (let i = 0; i < 5; i++) {
      expect((await checkAndRecordScanUsage('gold-user', 'gold', 10_000)).allowed).toBe(true)
    }
  })

  it('bypasses even a zero-quota feature gate — scanning stays available where a Free-tier plan would have it disabled entirely', async () => {
    process.env.FREE_TIER_SCAN_REQUESTS_PER_DAY = '0'
    process.env.FREE_TRIAL_SCAN_WORDS_TOTAL = '0'
    // A Free-tier account is correctly gated out (regression guard for the
    // behavior this test is contrasting against).
    const free = await checkAndRecordScanUsage('free-user', 'free', 10, '', RECENT_SIGNUP)
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

  it('a Gold account is never subject to Free-trial expiration, even with a very old accountCreatedAt', async () => {
    const result = await checkAndRecordGenerationUsage('gold-user', 'gold', 100, '', '2000-01-01T00:00:00.000Z')
    expect(result.allowed).toBe(true)
  })

  it('leaves Free-tier restrictions completely unchanged', async () => {
    process.env.FREE_TIER_GENERATION_REQUESTS_PER_DAY = '1'
    process.env.FREE_TRIAL_GENERATION_WORDS_TOTAL = '1000000'
    expect((await checkAndRecordGenerationUsage('free-user', 'free', 10, '', RECENT_SIGNUP)).allowed).toBe(true)
    const second = await checkAndRecordGenerationUsage('free-user', 'free', 10, '', RECENT_SIGNUP)
    expect(second.allowed).toBe(false)
    expect(second.code).toBe('LIMIT_EXCEEDED')
  })
})

describe('getUsageSummary', () => {
  it('reports a Free account\'s lifetime trial usage against the trial total, not a monthly figure', async () => {
    await checkAndRecordGenerationUsage('free-user', 'free', 120, '', RECENT_SIGNUP)
    await checkAndRecordScanUsage('free-user', 'free', 40, '', RECENT_SIGNUP)

    const summary = await getUsageSummary('free-user', 'free')
    expect(summary.tier).toBe('free')
    expect(summary.planName).toBe('Free')
    expect(summary.unlimited).toBe(false)
    expect(summary.available).toBe(true)
    expect(summary.generation).toEqual({ used: 120, limit: 1_200 })
    expect(summary.scan).toEqual({ used: 40, limit: 1_200 })
  })

  it('reports zero usage for an account with no recorded activity yet, rather than throwing', async () => {
    const summary = await getUsageSummary('brand-new-user', 'free')
    expect(summary.generation).toEqual({ used: 0, limit: 1_200 })
    expect(summary.scan).toEqual({ used: 0, limit: 1_200 })
  })

  it('reports a paid tier\'s usage against its monthly allowance', async () => {
    await checkAndRecordGenerationUsage('starter-user', 'starter', 500)

    const summary = await getUsageSummary('starter-user', 'starter')
    expect(summary.planName).toBe('Starter')
    expect(summary.generation).toEqual({ used: 500, limit: 50_000 })
    expect(summary.scan).toEqual({ used: 0, limit: 50_000 })
  })

  it('reports Gold as unlimited without touching Firestore', async () => {
    const summary = await getUsageSummary('gold-user', 'gold')
    expect(summary.unlimited).toBe(true)
    expect(summary.planName).toBe('Gold')
    expect(summary.generation.limit).toBeNull()
    expect(docStore.size).toBe(0)
  })

  it('reports an allowlisted email hash as unlimited', async () => {
    process.env.UNLIMITED_USAGE_EMAIL_HASHES = 'allowed-hash'
    const summary = await getUsageSummary('free-user', 'free', 'allowed-hash')
    expect(summary.unlimited).toBe(true)
  })

  it('does not advance or expire the trial — a summary read never records a request', async () => {
    // A plain read must never consume the daily request-rate budget that
    // checkAndRecordGenerationUsage enforces.
    process.env.FREE_TIER_GENERATION_REQUESTS_PER_DAY = '1'
    await getUsageSummary('free-user', 'free')
    await getUsageSummary('free-user', 'free')
    const result = await checkAndRecordGenerationUsage('free-user', 'free', 10, '', RECENT_SIGNUP)
    expect(result.allowed).toBe(true)
  })

  it('fails open with available: false (not a thrown error) when Firestore is unavailable', async () => {
    dbShouldThrow.value = true
    const summary = await getUsageSummary('free-user', 'free')
    expect(summary.available).toBe(false)
    expect(summary.generation).toEqual({ used: 0, limit: null })
  })
})

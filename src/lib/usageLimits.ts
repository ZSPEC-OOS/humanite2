import { db } from './firestore'
import { isGoldTier } from './accountTier'
import { PRICING_TIERS, type PricingTier } from './pricing'

// Three kinds of limits, kept conceptually and operationally separate:
//
//  - Free is a ONE-TIME, 30-DAY TRIAL, not a recurring monthly plan: a fixed
//    lifetime word allowance per pool, consumed cumulatively from signup,
//    that never resets — and the account loses access to metered features
//    entirely once 30 days have passed, regardless of how much of that
//    allowance is still unused.
//  - Starter/Pro/Max's MONTHLY WORD QUOTAS are the advertised recurring
//    subscription allowance (what the /pricing page promises: "50,000
//    words/month"). They reset on a calendar-month boundary (a YYYY-MM
//    period key), not daily — a user who writes 10,000 words on day 1 and 0
//    for the rest of the month must still have budget left on day 2, which a
//    daily word cap cannot express.
//  - DAILY REQUEST-RATE limits are an abuse backstop only (burst/scripting
//    protection against this deployment's own paid OpenAI-compatible/GPTZero
//    keys), unrelated to either word allowance above, and apply to every
//    tier including Free.
//
// A request is checked against its tier's word pool AND today's request-rate
// budget in one atomic transaction (two Firestore documents) so a request
// that fails either check never partially records against the other.
type SelfServeTierId = 'free' | 'starter' | 'pro' | 'enterprise'
type MonthlyTierId = 'starter' | 'pro' | 'enterprise'

// Canonical monthly word allowances for the three RECURRING paid tiers —
// must match the /pricing page's advertised numbers exactly (see
// pricing.ts's PRICING_TIERS features). Equal generated/scanned quotas per
// tier; scan is metered independently because GPTZero costs roughly two
// orders of magnitude more per word than generation (see
// checkAndRecordMonthlyUsage below). Free is NOT here — see
// FREE_TRIAL_WORD_LIMITS, since its word allowance is a one-time trial
// total, not a monthly figure.
const TIER_WORD_LIMITS: Record<MonthlyTierId, { generationWordsPerMonth: number; scanWordsPerMonth: number }> = {
  starter: { generationWordsPerMonth: 50_000, scanWordsPerMonth: 50_000 },
  pro: { generationWordsPerMonth: 100_000, scanWordsPerMonth: 100_000 },
  enterprise: { generationWordsPerMonth: 150_000, scanWordsPerMonth: 150_000 },
}

// Free's one-time, lifetime (never-resetting) trial allowance, and how long
// after account creation it remains usable at all. Both read fresh from env
// on every call, like every other limit below, so either can be tuned
// without a redeploy.
const FREE_TRIAL_DAYS_DEFAULT = 30
const FREE_TRIAL_WORD_LIMITS_DEFAULT = { generationWordsTotal: 1_200, scanWordsTotal: 1_200 }

// Daily request-rate ceilings — an abuse/burst backstop, not the advertised
// plan quota. Deliberately generous relative to what a legitimate workflow
// needs in a day; their purpose is bounding worst-case spend on a
// compromised/scripted account, not shaping normal usage. Free's trial
// allowance is so small (see above) that these rarely bind in practice —
// they're a backstop for the trial too, not specific to recurring tiers.
const TIER_REQUEST_LIMITS: Record<SelfServeTierId, { generationRequestsPerDay: number; scanRequestsPerDay: number }> = {
  free: { generationRequestsPerDay: 25, scanRequestsPerDay: 10 },
  starter: { generationRequestsPerDay: 100, scanRequestsPerDay: 20 },
  pro: { generationRequestsPerDay: 150, scanRequestsPerDay: 40 },
  enterprise: { generationRequestsPerDay: 300, scanRequestsPerDay: 60 },
}

function envOverride(name: string): number | null {
  const raw = process.env[name]
  if (raw === undefined) return null
  const parsed = Number(raw)
  // 0 is a legitimate, documented override (a plan with a pool's
  // requests/words explicitly set to 0 doesn't include that feature at all —
  // see the gating checks below) — not the same as "unset". Only a negative
  // or non-numeric value is treated as no override.
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

// Explicit, exhaustive mapping — an unrecognized tier (a stale JWT from
// before a tier was renamed, a typo, a tier that was retired) always falls
// through to 'free', and 'starter' never silently collapses into it. Gold
// bypasses this function entirely (see isGoldTier check in
// checkAndRecordPoolUsage) — it is not one of these four self-serve tiers.
function normalizeTier(tier: string): SelfServeTierId {
  switch (tier) {
    case 'free':
    case 'starter':
    case 'pro':
    case 'enterprise':
      return tier
    default:
      return 'free'
  }
}

function requestLimitsForTier(tier: SelfServeTierId) {
  const fallback = TIER_REQUEST_LIMITS[tier]
  const prefix = tier.toUpperCase()
  return {
    generation: { requestsPerDay: envOverride(`${prefix}_TIER_GENERATION_REQUESTS_PER_DAY`) ?? fallback.generationRequestsPerDay },
    scan: { requestsPerDay: envOverride(`${prefix}_TIER_SCAN_REQUESTS_PER_DAY`) ?? fallback.scanRequestsPerDay },
  }
}

// Reads any env override fresh on every call rather than once at module
// load, so a changed limit takes effect without a redeploy/restart. Takes an
// already-normalized MONTHLY tier (never 'free' — see
// checkAndRecordFreeTrialUsage for that path).
function monthlyWordLimitsForTier(tier: MonthlyTierId) {
  const fallback = TIER_WORD_LIMITS[tier]
  const prefix = tier.toUpperCase()
  return {
    generation: { wordsPerMonth: envOverride(`${prefix}_TIER_GENERATION_WORDS_PER_MONTH`) ?? fallback.generationWordsPerMonth },
    scan: { wordsPerMonth: envOverride(`${prefix}_TIER_SCAN_WORDS_PER_MONTH`) ?? fallback.scanWordsPerMonth },
  }
}

function freeTrialDays(): number {
  return envOverride('FREE_TRIAL_DAYS') ?? FREE_TRIAL_DAYS_DEFAULT
}

function freeTrialWordLimits() {
  return {
    generation: { wordsTotal: envOverride('FREE_TRIAL_GENERATION_WORDS_TOTAL') ?? FREE_TRIAL_WORD_LIMITS_DEFAULT.generationWordsTotal },
    scan: { wordsTotal: envOverride('FREE_TRIAL_SCAN_WORDS_TOTAL') ?? FREE_TRIAL_WORD_LIMITS_DEFAULT.scanWordsTotal },
  }
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10) // YYYY-MM-DD, UTC — daily request-rate pool only
}

function monthKey(): string {
  return new Date().toISOString().slice(0, 7) // YYYY-MM, UTC — monthly word-quota pool (Starter/Pro/Max only)
}

// The next tier up the public pricing ladder, in PRICING_TIERS' own order
// (Free -> Starter -> Pro -> Max) — null for the top tier, so a Max account
// hitting its limit is never told to "upgrade to Enterprise".
function nextTier(tier: SelfServeTierId): PricingTier | null {
  const idx = PRICING_TIERS.findIndex(t => t.id === tier)
  if (idx === -1 || idx === PRICING_TIERS.length - 1) return null
  return PRICING_TIERS[idx + 1] ?? null
}

function publicName(tier: SelfServeTierId): string {
  return PRICING_TIERS.find(t => t.id === tier)?.name ?? 'current'
}

// "You've reached your Starter monthly word allowance. Upgrade to Pro for
// 100,000 generated and scanned words per month." — never suggests a tier
// above Max, and always names the concrete next-tier allowance rather than a
// generic "upgrade for more".
function monthlyLimitMessage(tier: MonthlyTierId, pool: UsagePool, limit: number): string {
  const poolLabel = pool === 'scan' ? 'scanned' : 'generated'
  const base = `You've reached your ${publicName(tier)} monthly ${poolLabel}-word allowance (${limit.toLocaleString()} words/month).`
  const next = nextTier(tier)
  if (!next) return base
  const nextLimits = TIER_WORD_LIMITS[next.id as MonthlyTierId]
  if (!nextLimits) return base
  return `${base} Upgrade to ${next.name} for ${nextLimits.generationWordsPerMonth.toLocaleString()} generated and ${nextLimits.scanWordsPerMonth.toLocaleString()} scanned words per month.`
}

// "You've used your Free trial's 1,200 generated words. Upgrade to Starter
// for 50,000 generated and scanned words every month." — the trial total is
// a one-time allowance, never a monthly one, so this is worded distinctly
// from monthlyLimitMessage even though it plays the same role.
function trialQuotaExhaustedMessage(pool: UsagePool, limit: number): string {
  const poolLabel = pool === 'scan' ? 'scanned' : 'generated'
  const base = `You've used your Free trial's ${limit.toLocaleString()} ${poolLabel} words.`
  const next = nextTier('free')
  if (!next) return base
  const nextLimits = TIER_WORD_LIMITS[next.id as MonthlyTierId]
  if (!nextLimits) return base
  return `${base} Upgrade to ${next.name} for ${nextLimits.generationWordsPerMonth.toLocaleString()} generated and ${nextLimits.scanWordsPerMonth.toLocaleString()} scanned words every month.`
}

function trialExpiredMessage(): string {
  const next = nextTier('free')
  const days = freeTrialDays()
  const upgrade = next ? ` Upgrade to ${next.name} to keep using Humanite.` : ''
  return `Your ${days}-day Free trial has ended.${upgrade}`
}

// Sha256(email) hashes (matching auth-utils.ts's issueAccessToken, which is
// the only producer of the email_hash JWT claim callers pass in here) that
// bypass both pools' quotas entirely — an operator/owner allowlist for
// accounts that shouldn't be metered against this deployment's own paid
// keys, distinct from the free/starter/pro/enterprise tiers above.
// Comma-separated; re-read on every call like the tier overrides, for the
// same reason.
function unlimitedEmailHashes(): Set<string> {
  const raw = process.env.UNLIMITED_USAGE_EMAIL_HASHES ?? ''
  return new Set(
    raw.split(',').map((h) => h.trim().toLowerCase()).filter(Boolean),
  )
}

export interface UsageCheckResult {
  allowed: boolean
  reason?: string
  // Lets a caller tell "you're over budget" (429 — a real, known limit) apart
  // from "we couldn't check your budget" (503 — an infrastructure problem).
  // A Free trial that has ended is reported as LIMIT_EXCEEDED too (429) —
  // it's the same "nothing left to give this request" shape from the
  // caller's point of view, just distinguished by `reason`.
  // Only set when allowed is false.
  code?: 'LIMIT_EXCEEDED' | 'UNAVAILABLE'
}

type UsagePool = 'generation' | 'scan'

function isTrialExpired(accountCreatedAt: string): boolean {
  const createdMs = Date.parse(accountCreatedAt)
  // An empty/unparsable createdAt (a legacy or malformed claim) is treated
  // as "unknown, not expired" — failing open on THIS ONE SIGNAL rather than
  // blocking an otherwise-legitimate account over missing historical data.
  // The word/request quotas below still apply normally either way.
  if (Number.isNaN(createdMs)) return false
  const trialEndsMs = createdMs + freeTrialDays() * 24 * 60 * 60 * 1000
  return Date.now() > trialEndsMs
}

// Free's one-time, 30-day trial: a lifetime word allowance per pool
// (usage_trial/{userId}, never reset — contrast with the monthly path's
// per-period document) plus the same daily request-rate backstop every tier
// gets, PLUS a hard cutoff once the trial window itself has elapsed,
// independent of how much of the word allowance remains unused.
async function checkAndRecordFreeTrialUsage(
  userId: string,
  words: number,
  pool: UsagePool,
  accountCreatedAt: string,
): Promise<UsageCheckResult> {
  if (isTrialExpired(accountCreatedAt)) {
    return { allowed: false, code: 'LIMIT_EXCEEDED', reason: trialExpiredMessage() }
  }

  const requestLimit = requestLimitsForTier('free')[pool].requestsPerDay
  const trialWordLimit = freeTrialWordLimits()[pool].wordsTotal
  const requestField = `${pool}Requests`
  const wordField = `${pool}Words`

  if (requestLimit <= 0 || trialWordLimit <= 0) {
    return {
      allowed: false,
      code: 'LIMIT_EXCEEDED',
      reason: pool === 'scan'
        ? 'AI-detection scanning isn\'t included in your plan.'
        : 'This feature isn\'t included in your plan.',
    }
  }

  try {
    // Built inside the try/catch specifically so db() throwing synchronously
    // (e.g. missing Firebase credentials) is caught the same way a rejected
    // transaction is, rather than escaping this function uncaught.
    const trialRef = db().collection('usage_trial').doc(userId)
    const dailyRef = db().collection('usage_daily').doc(`${userId}_${todayKey()}`)
    return await db().runTransaction(async (tx) => {
      const [trialSnap, dailySnap] = await Promise.all([tx.get(trialRef), tx.get(dailyRef)])
      const trial = (trialSnap.exists ? trialSnap.data() : null) as Record<string, number> | null
      const daily = (dailySnap.exists ? dailySnap.data() : null) as Record<string, number> | null
      const usedWords = trial?.[wordField] ?? 0
      const dailyRequests = daily?.[requestField] ?? 0

      if (dailyRequests + 1 > requestLimit) {
        return {
          allowed: false,
          code: 'LIMIT_EXCEEDED',
          reason: `Daily ${pool} request limit reached (${requestLimit}/day). Resets at UTC midnight.`,
        }
      }
      if (usedWords + words > trialWordLimit) {
        return {
          allowed: false,
          code: 'LIMIT_EXCEEDED',
          reason: trialQuotaExhaustedMessage(pool, trialWordLimit),
        }
      }

      tx.set(trialRef, { [wordField]: usedWords + words, updatedAt: new Date() }, { merge: true })
      tx.set(dailyRef, { [requestField]: dailyRequests + 1, updatedAt: new Date() }, { merge: true })
      return { allowed: true }
    })
  } catch (err) {
    console.warn(`Usage limit check unavailable (${pool}, free trial) — rejecting request rather than spending unmetered`, {
      type: err instanceof Error ? err.constructor.name : typeof err,
    })
    return {
      allowed: false,
      code: 'UNAVAILABLE',
      reason: 'Usage tracking is temporarily unavailable. Please try again shortly.',
    }
  }
}

// Starter/Pro/Max's recurring monthly word quota, unchanged in shape from
// before Free became a separate trial: this month's word quota AND today's
// request-rate budget, checked and recorded atomically.
async function checkAndRecordMonthlyUsage(
  userId: string,
  tier: MonthlyTierId,
  words: number,
  pool: UsagePool,
): Promise<UsageCheckResult> {
  const requestLimit = requestLimitsForTier(tier)[pool].requestsPerDay
  const monthlyWordLimit = monthlyWordLimitsForTier(tier)[pool].wordsPerMonth
  const requestField = `${pool}Requests`
  const wordField = `${pool}Words`

  // A plan with zero scan quota doesn't have the feature at all — "limit
  // reached (0/day)" would misleadingly read as "you used it up" rather
  // than "your plan doesn't include this."
  if (requestLimit <= 0 || monthlyWordLimit <= 0) {
    return {
      allowed: false,
      code: 'LIMIT_EXCEEDED',
      reason: pool === 'scan'
        ? 'AI-detection scanning isn\'t included in your plan.'
        : 'This feature isn\'t included in your plan.',
    }
  }

  const period = monthKey()

  try {
    const monthlyRef = db().collection('usage_monthly').doc(`${userId}_${period}`)
    const dailyRef = db().collection('usage_daily').doc(`${userId}_${todayKey()}`)
    return await db().runTransaction(async (tx) => {
      const [monthlySnap, dailySnap] = await Promise.all([tx.get(monthlyRef), tx.get(dailyRef)])
      const monthly = (monthlySnap.exists ? monthlySnap.data() : null) as Record<string, number> | null
      const daily = (dailySnap.exists ? dailySnap.data() : null) as Record<string, number> | null
      const usedWords = monthly?.[wordField] ?? 0
      const dailyRequests = daily?.[requestField] ?? 0

      if (dailyRequests + 1 > requestLimit) {
        return {
          allowed: false,
          code: 'LIMIT_EXCEEDED',
          reason: `Daily ${pool} request limit reached (${requestLimit}/day). Resets at UTC midnight.`,
        }
      }
      if (usedWords + words > monthlyWordLimit) {
        return {
          allowed: false,
          code: 'LIMIT_EXCEEDED',
          reason: monthlyLimitMessage(tier, pool, monthlyWordLimit),
        }
      }

      tx.set(
        monthlyRef,
        { [wordField]: usedWords + words, period, updatedAt: new Date() },
        { merge: true },
      )
      tx.set(
        dailyRef,
        { [requestField]: dailyRequests + 1, updatedAt: new Date() },
        { merge: true },
      )
      return { allowed: true }
    })
  } catch (err) {
    console.warn(`Usage limit check unavailable (${pool}) — rejecting request rather than spending unmetered`, {
      type: err instanceof Error ? err.constructor.name : typeof err,
    })
    return {
      allowed: false,
      code: 'UNAVAILABLE',
      reason: 'Usage tracking is temporarily unavailable. Please try again shortly.',
    }
  }
}

// Checks (and, if allowed, records) this request's contribution to the
// caller's tier-appropriate quota for the given pool. Fails CLOSED (rejects
// the request) if Firestore itself is unavailable — unlike jobs/presets/
// config sync elsewhere in this app, which fail open because a degraded UX
// is the only cost. This function is only ever called on the path that
// spends this deployment's own paid key for that pool (callers skip it
// entirely for a caller's own BYOK key — see humanize/route.ts, scan/
// route.ts, and tryClassifyOutput in humanizeOutput.ts), so failing open
// here would mean one Firestore outage removes all spend protection on keys
// this deployment pays for.
async function checkAndRecordPoolUsage(
  userId: string,
  tier: string,
  words: number,
  pool: UsagePool,
  emailHash: string,
  accountCreatedAt: string,
): Promise<UsageCheckResult> {
  // Gold accounts skip the quota (and the Firestore write) entirely — a
  // first-class, unrestricted account tier (see accountTier.ts), not a
  // parallel bypass mechanism. Checked first so it also overrides the "not
  // included in your plan"/trial-expired gates below: a plan tier can
  // legitimately not include a feature, but Gold's whole point is having no
  // such gate.
  if (isGoldTier(tier)) {
    return { allowed: true }
  }

  // Allowlisted accounts skip the quota (and the Firestore write) entirely —
  // checked first so it also overrides the gates below.
  if (emailHash && unlimitedEmailHashes().has(emailHash.toLowerCase())) {
    return { allowed: true }
  }

  const normalizedTier = normalizeTier(tier)
  if (normalizedTier === 'free') {
    return checkAndRecordFreeTrialUsage(userId, words, pool, accountCreatedAt)
  }
  return checkAndRecordMonthlyUsage(userId, normalizedTier, words, pool)
}

export async function checkAndRecordGenerationUsage(userId: string, tier: string, words: number, emailHash = '', accountCreatedAt = ''): Promise<UsageCheckResult> {
  return checkAndRecordPoolUsage(userId, tier, words, 'generation', emailHash, accountCreatedAt)
}

export async function checkAndRecordScanUsage(userId: string, tier: string, words: number, emailHash = '', accountCreatedAt = ''): Promise<UsageCheckResult> {
  return checkAndRecordPoolUsage(userId, tier, words, 'scan', emailHash, accountCreatedAt)
}

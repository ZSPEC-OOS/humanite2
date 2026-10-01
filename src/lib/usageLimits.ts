import { db } from './firestore'
import { isGoldTier } from './accountTier'
import { PRICING_TIERS, type PricingTier } from './pricing'

// Two kinds of limits, kept conceptually and operationally separate
// ("Final Polish" pricing patch, §14/§16):
//
//  - MONTHLY WORD QUOTAS are the advertised subscription allowance (what the
//    /pricing page promises: "50,000 words/month"). They reset on a
//    calendar-month boundary (a YYYY-MM period key), not daily — a user who
//    writes 10,000 words on day 1 and 0 for the rest of the month must still
//    have budget left on day 2, which a daily word cap cannot express.
//  - DAILY REQUEST-RATE limits are an abuse backstop only (burst/scripting
//    protection against this deployment's own paid OpenAI-compatible/GPTZero
//    keys), unrelated to the advertised monthly quota. They reset at UTC
//    midnight, same as before this patch.
//
// A request is checked against BOTH pools in one atomic transaction (two
// Firestore documents: a per-user-per-month word-usage doc and a
// per-user-per-day request-rate doc) so a request that fails either check
// never partially records against the other.
export interface UsagePoolLimits {
  requestsPerDay: number
  wordsPerMonth: number
}

export interface TierLimits {
  generation: UsagePoolLimits
  scan: UsagePoolLimits
}

type SelfServeTierId = 'free' | 'starter' | 'pro' | 'enterprise'

// Canonical monthly word allowances — must match the /pricing page's
// advertised numbers exactly (see pricing.ts's PRICING_TIERS features).
// Equal generated/scanned quotas per tier; scan is metered independently
// because GPTZero costs roughly two orders of magnitude more per word than
// generation (see checkAndRecordPoolUsage below).
const TIER_WORD_LIMITS: Record<SelfServeTierId, { generationWordsPerMonth: number; scanWordsPerMonth: number }> = {
  free: { generationWordsPerMonth: 5_000, scanWordsPerMonth: 5_000 },
  starter: { generationWordsPerMonth: 50_000, scanWordsPerMonth: 50_000 },
  pro: { generationWordsPerMonth: 100_000, scanWordsPerMonth: 100_000 },
  enterprise: { generationWordsPerMonth: 150_000, scanWordsPerMonth: 150_000 },
}

// Daily request-rate ceilings — an abuse/burst backstop, not the advertised
// plan quota (§16). Deliberately generous relative to what a legitimate
// workflow needs in a day; their purpose is bounding worst-case spend on a
// compromised/scripted account, not shaping normal usage.
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
  // see the gating check below) — not the same as "unset". Only a negative
  // or non-numeric value is treated as no override.
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null
}

// Explicit, exhaustive mapping — an unrecognized tier (a stale JWT from
// before a tier was renamed, a typo, a tier that was retired) always falls
// through to 'free', and 'starter' never silently collapses into it ("Final
// Polish" pricing patch, §18). Gold bypasses this function entirely (see
// isGoldTier check in checkAndRecordPoolUsage) — it is not one of these four
// self-serve tiers.
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

// Reads any env override fresh on every call rather than once at module
// load, so a changed limit takes effect without a redeploy/restart.
function limitsForTier(tier: string): TierLimits {
  const key = normalizeTier(tier)
  const wordFallback = TIER_WORD_LIMITS[key]
  const requestFallback = TIER_REQUEST_LIMITS[key]
  const prefix = key.toUpperCase()
  return {
    generation: {
      requestsPerDay: envOverride(`${prefix}_TIER_GENERATION_REQUESTS_PER_DAY`) ?? requestFallback.generationRequestsPerDay,
      wordsPerMonth: envOverride(`${prefix}_TIER_GENERATION_WORDS_PER_MONTH`) ?? wordFallback.generationWordsPerMonth,
    },
    scan: {
      requestsPerDay: envOverride(`${prefix}_TIER_SCAN_REQUESTS_PER_DAY`) ?? requestFallback.scanRequestsPerDay,
      wordsPerMonth: envOverride(`${prefix}_TIER_SCAN_WORDS_PER_MONTH`) ?? wordFallback.scanWordsPerMonth,
    },
  }
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10) // YYYY-MM-DD, UTC — daily request-rate pool only
}

function monthKey(): string {
  return new Date().toISOString().slice(0, 7) // YYYY-MM, UTC — monthly word-quota pool
}

// The next tier up the public pricing ladder, in PRICING_TIERS' own order
// (Free -> Starter -> Pro -> Max) — null for the top tier, so a Max account
// hitting its limit is never told to "upgrade to Enterprise" (§30/§40).
function nextTier(tier: SelfServeTierId): PricingTier | null {
  const idx = PRICING_TIERS.findIndex(t => t.id === tier)
  if (idx === -1 || idx === PRICING_TIERS.length - 1) return null
  return PRICING_TIERS[idx + 1] ?? null
}

function publicName(tier: SelfServeTierId): string {
  return PRICING_TIERS.find(t => t.id === tier)?.name ?? 'current'
}

// "You've reached your Free monthly word allowance. Upgrade to Starter for
// 50,000 generated and scanned words per month." (§30) — never suggests a
// tier above Max, and always names the concrete next-tier allowance rather
// than a generic "upgrade for more".
function monthlyLimitMessage(tier: SelfServeTierId, pool: UsagePool, limit: number): string {
  const poolLabel = pool === 'scan' ? 'scanned' : 'generated'
  const base = `You've reached your ${publicName(tier)} monthly ${poolLabel}-word allowance (${limit.toLocaleString()} words/month).`
  const next = nextTier(tier)
  if (!next) return base
  const nextLimits = TIER_WORD_LIMITS[next.id as SelfServeTierId]
  if (!nextLimits) return base
  return `${base} Upgrade to ${next.name} for ${nextLimits.generationWordsPerMonth.toLocaleString()} generated and ${nextLimits.scanWordsPerMonth.toLocaleString()} scanned words per month.`
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
  // Only set when allowed is false.
  code?: 'LIMIT_EXCEEDED' | 'UNAVAILABLE'
}

type UsagePool = 'generation' | 'scan'

// Atomically checks this month's word quota AND today's request-rate budget
// against the caller's tier limits for the given pool and, if both are still
// under budget, records this request's contribution to both in the same
// Firestore transaction — so two concurrent requests can't both read "under
// budget" and both slip through, and a request that fails one pool never
// partially records against the other. Fails CLOSED (rejects the request)
// if Firestore itself is unavailable — unlike jobs/presets/config sync
// elsewhere in this app, which fail open because a degraded UX is the only
// cost. This function is only ever called on the path that spends this
// deployment's own paid key for that pool (callers skip it entirely for a
// caller's own BYOK key — see humanize/route.ts, scan/route.ts, and
// tryClassifyOutput in humanizeOutput.ts), so failing open here would mean
// one Firestore outage removes all spend protection on keys this deployment
// pays for.
async function checkAndRecordPoolUsage(
  userId: string,
  tier: string,
  words: number,
  pool: UsagePool,
  emailHash: string,
): Promise<UsageCheckResult> {
  // Gold accounts skip the quota (and the Firestore write) entirely — a
  // first-class, unrestricted account tier (see accountTier.ts), not a
  // parallel bypass mechanism. Checked first so it also overrides the "not
  // included in your plan" zero-quota gate below: a plan tier can legitimately
  // not include a feature, but Gold's whole point is having no such gate.
  if (isGoldTier(tier)) {
    return { allowed: true }
  }

  // Allowlisted accounts skip the quota (and the Firestore write) entirely —
  // checked first so it also overrides the "not included in your plan" gate
  // below.
  if (emailHash && unlimitedEmailHashes().has(emailHash.toLowerCase())) {
    return { allowed: true }
  }

  const normalizedTier = normalizeTier(tier)
  const limits = limitsForTier(tier)[pool]
  const requestField = `${pool}Requests`
  const wordField = `${pool}Words`

  // A plan with zero scan quota doesn't have the feature at all — "limit
  // reached (0/day)" would misleadingly read as "you used it up" rather
  // than "your plan doesn't include this."
  if (limits.requestsPerDay <= 0 || limits.wordsPerMonth <= 0) {
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
    // Built inside the try/catch specifically so db() throwing synchronously
    // (e.g. missing Firebase credentials) is caught the same way a rejected
    // transaction is, rather than escaping this function uncaught.
    const monthlyRef = db().collection('usage_monthly').doc(`${userId}_${period}`)
    const dailyRef = db().collection('usage_daily').doc(`${userId}_${todayKey()}`)
    return await db().runTransaction(async (tx) => {
      const [monthlySnap, dailySnap] = await Promise.all([tx.get(monthlyRef), tx.get(dailyRef)])
      const monthly = (monthlySnap.exists ? monthlySnap.data() : null) as Record<string, number> | null
      const daily = (dailySnap.exists ? dailySnap.data() : null) as Record<string, number> | null
      const usedWords = monthly?.[wordField] ?? 0
      const dailyRequests = daily?.[requestField] ?? 0

      if (dailyRequests + 1 > limits.requestsPerDay) {
        return {
          allowed: false,
          code: 'LIMIT_EXCEEDED',
          reason: `Daily ${pool} request limit reached (${limits.requestsPerDay}/day). Resets at UTC midnight.`,
        }
      }
      if (usedWords + words > limits.wordsPerMonth) {
        return {
          allowed: false,
          code: 'LIMIT_EXCEEDED',
          reason: monthlyLimitMessage(normalizedTier, pool, limits.wordsPerMonth),
        }
      }

      tx.set(
        monthlyRef,
        { [wordField]: usedWords + words, [requestField]: (monthly?.[requestField] ?? 0) + 1, period, updatedAt: new Date() },
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

export async function checkAndRecordGenerationUsage(userId: string, tier: string, words: number, emailHash = ''): Promise<UsageCheckResult> {
  return checkAndRecordPoolUsage(userId, tier, words, 'generation', emailHash)
}

export async function checkAndRecordScanUsage(userId: string, tier: string, words: number, emailHash = ''): Promise<UsageCheckResult> {
  return checkAndRecordPoolUsage(userId, tier, words, 'scan', emailHash)
}

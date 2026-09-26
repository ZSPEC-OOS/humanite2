import { db } from './firestore'

// Two independent daily quotas per authenticated user — generation
// (humanize) and scan (AI-detection) — so one account can't run up this
// deployment's own paid OpenAI-compatible/GPTZero usage unbounded. Split
// into separate pools (rather than one shared word count) because the two
// costs are wildly different per word (GPTZero runs roughly two orders of
// magnitude more per word than generation) — a plan can offer generous
// generation while still metering scanning tightly, and vice versa. This is
// an abuse backstop, not the primary monetization lever; the pricing page's
// advertised limits should stay comfortably under these. Override any of
// these via env if the defaults turn out wrong in practice.
export interface UsagePoolLimits {
  requestsPerDay: number
  wordsPerDay: number
}

export interface TierLimits {
  generation: UsagePoolLimits
  scan: UsagePoolLimits
}

// Numbers below track the locked $5 / $10 / $15 plan design (free/pro/
// enterprise are the existing internal tier keys — see
// auth-utils.ts/userRegistration.ts — not renamed to match, since real
// accounts already carry these values in their stored `tier` field; only the
// pricing page's display name/price changed). Each tier advertises equal
// generated and scanned word quotas per month — 50,000 / 100,000 / 150,000
// — at a ~70% cost margin against DeepSeek generation + Sapling scanning
// rates. wordsPerDay is that monthly figure divided by 30 (Sapling costs far
// more per word than generation, hence the two pools staying independent).
const FALLBACK_LIMITS: Record<'free' | 'pro' | 'enterprise', TierLimits> = {
  free: {
    generation: { requestsPerDay: 100, wordsPerDay: 1_667 },   // 50,000 words/month
    scan:       { requestsPerDay: 20,  wordsPerDay: 1_667 },   // 50,000 words/month
  },
  pro: {
    generation: { requestsPerDay: 150, wordsPerDay: 3_333 },   // 100,000 words/month
    scan:       { requestsPerDay: 40,  wordsPerDay: 3_333 },   // 100,000 words/month
  },
  enterprise: {
    generation: { requestsPerDay: 300, wordsPerDay: 5_000 },   // 150,000 words/month
    scan:       { requestsPerDay: 60,  wordsPerDay: 5_000 },   // 150,000 words/month
  },
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

// Reads any env override fresh on every call rather than once at module
// load, so a changed limit takes effect without a redeploy/restart.
function limitsForTier(tier: string): TierLimits {
  const key = tier === 'pro' || tier === 'enterprise' ? tier : 'free'
  const fallback = FALLBACK_LIMITS[key]
  const prefix = key.toUpperCase()
  return {
    generation: {
      requestsPerDay: envOverride(`${prefix}_TIER_GENERATION_REQUESTS_PER_DAY`) ?? fallback.generation.requestsPerDay,
      wordsPerDay: envOverride(`${prefix}_TIER_GENERATION_WORDS_PER_DAY`) ?? fallback.generation.wordsPerDay,
    },
    scan: {
      requestsPerDay: envOverride(`${prefix}_TIER_SCAN_REQUESTS_PER_DAY`) ?? fallback.scan.requestsPerDay,
      wordsPerDay: envOverride(`${prefix}_TIER_SCAN_WORDS_PER_DAY`) ?? fallback.scan.wordsPerDay,
    },
  }
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10) // YYYY-MM-DD, UTC
}

// Sha256(email) hashes (matching auth-utils.ts's issueAccessToken, which is
// the only producer of the email_hash JWT claim callers pass in here) that
// bypass both pools' quotas entirely — an operator/owner allowlist for
// accounts that shouldn't be metered against this deployment's own paid
// keys, distinct from the free/pro/enterprise tiers above. Comma-separated;
// re-read on every call like the tier overrides, for the same reason.
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

// Atomically checks today's usage against the caller's tier limits for the
// given pool and, if still under budget, records this request's
// contribution in the same Firestore transaction — so two concurrent
// requests can't both read "under budget" and both slip through. Fails
// CLOSED (rejects the request) if Firestore itself is unavailable — unlike
// jobs/presets/config sync elsewhere in this app, which fail open because a
// degraded UX is the only cost. This function is only ever called on the
// path that spends this deployment's own paid key for that pool (callers
// skip it entirely for a caller's own BYOK key — see humanize/route.ts,
// scan/route.ts, and tryClassifyOutput in humanizeOutput.ts), so failing
// open here would mean one Firestore outage removes all spend protection on
// keys this deployment pays for.
async function checkAndRecordPoolUsage(
  userId: string,
  tier: string,
  words: number,
  pool: UsagePool,
  emailHash: string,
): Promise<UsageCheckResult> {
  // Allowlisted accounts skip the quota (and the Firestore write) entirely —
  // checked first so it also overrides the "not included in your plan" gate
  // below.
  if (emailHash && unlimitedEmailHashes().has(emailHash.toLowerCase())) {
    return { allowed: true }
  }

  const limits = limitsForTier(tier)[pool]
  const reqField = `${pool}Requests`
  const wordField = `${pool}Words`

  // A plan with zero scan quota doesn't have the feature at all — "limit
  // reached (0/day)" would misleadingly read as "you used it up" rather
  // than "your plan doesn't include this."
  if (limits.requestsPerDay <= 0 || limits.wordsPerDay <= 0) {
    return {
      allowed: false,
      code: 'LIMIT_EXCEEDED',
      reason: pool === 'scan'
        ? 'AI-detection scanning isn\'t included in your plan.'
        : 'This feature isn\'t included in your plan.',
    }
  }

  try {
    const docRef = db().collection('usage').doc(`${userId}_${todayKey()}`)
    return await db().runTransaction(async (tx) => {
      const snap = await tx.get(docRef)
      const current = (snap.exists ? snap.data() : null) as Record<string, number> | null
      const requests = current?.[reqField] ?? 0
      const usedWords = current?.[wordField] ?? 0

      if (requests + 1 > limits.requestsPerDay) {
        return {
          allowed: false,
          code: 'LIMIT_EXCEEDED',
          reason: `Daily ${pool} request limit reached (${limits.requestsPerDay}/day). Resets at UTC midnight.`,
        }
      }
      if (usedWords + words > limits.wordsPerDay) {
        return {
          allowed: false,
          code: 'LIMIT_EXCEEDED',
          reason: `Daily ${pool} word limit reached (${limits.wordsPerDay.toLocaleString()} words/day). Resets at UTC midnight.`,
        }
      }

      tx.set(
        docRef,
        { [reqField]: requests + 1, [wordField]: usedWords + words, updatedAt: new Date() },
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

import { db } from './firestore'

// Simple daily quotas, per authenticated user, so one account (compromised,
// scripted, or just buggy) can't run up this deployment's own paid
// OpenAI/GPTZero usage unbounded. Deliberately generous relative to the
// pricing page's advertised limits (spec: Free gets "unlimited quick
// scans", Pro/Enterprise even more headroom) — this is an abuse backstop,
// not a monetization throttle, so real usage should never come close.
// Override any of these via env if the defaults turn out wrong in practice.
export interface UsageLimits {
  requestsPerDay: number
  wordsPerDay: number
}

const FALLBACK_LIMITS: Record<'free' | 'pro' | 'enterprise', UsageLimits> = {
  free: { requestsPerDay: 60, wordsPerDay: 150_000 },
  pro: { requestsPerDay: 600, wordsPerDay: 1_500_000 },
  enterprise: { requestsPerDay: 6_000, wordsPerDay: 15_000_000 },
}

function envOverride(name: string): number | null {
  const raw = Number(process.env[name])
  return Number.isFinite(raw) && raw > 0 ? raw : null
}

// Reads any env override fresh on every call rather than once at module
// load, so a changed limit takes effect without a redeploy/restart.
function limitsForTier(tier: string): UsageLimits {
  const key = tier === 'pro' || tier === 'enterprise' ? tier : 'free'
  const fallback = FALLBACK_LIMITS[key]
  const prefix = key.toUpperCase()
  return {
    requestsPerDay: envOverride(`${prefix}_TIER_REQUESTS_PER_DAY`) ?? fallback.requestsPerDay,
    wordsPerDay: envOverride(`${prefix}_TIER_WORDS_PER_DAY`) ?? fallback.wordsPerDay,
  }
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10) // YYYY-MM-DD, UTC
}

export interface UsageCheckResult {
  allowed: boolean
  reason?: string
}

// Atomically checks today's usage against the caller's tier limits and, if
// still under budget, records this request's contribution in the same
// Firestore transaction — so two concurrent requests can't both read
// "under budget" and both slip through. Fails open (allows the request,
// logs a warning) if Firestore itself is unavailable, matching this app's
// existing posture elsewhere (jobs, presets, and config sync all degrade
// the same way — see tryPersist in firestore.ts) rather than making quota
// tracking a single point of failure for the whole product.
export async function checkAndRecordUsage(
  userId: string,
  tier: string,
  words: number,
): Promise<UsageCheckResult> {
  const limits = limitsForTier(tier)
  const docRef = db().collection('usage').doc(`${userId}_${todayKey()}`)

  try {
    return await db().runTransaction(async (tx) => {
      const snap = await tx.get(docRef)
      const current = (snap.exists ? snap.data() : null) as { requests: number; words: number } | null
      const requests = current?.requests ?? 0
      const usedWords = current?.words ?? 0

      if (requests + 1 > limits.requestsPerDay) {
        return {
          allowed: false,
          reason: `Daily request limit reached (${limits.requestsPerDay}/day). Resets at UTC midnight.`,
        }
      }
      if (usedWords + words > limits.wordsPerDay) {
        return {
          allowed: false,
          reason: `Daily word limit reached (${limits.wordsPerDay.toLocaleString()} words/day). Resets at UTC midnight.`,
        }
      }

      tx.set(
        docRef,
        { requests: requests + 1, words: usedWords + words, updatedAt: new Date() },
        { merge: true },
      )
      return { allowed: true }
    })
  } catch (err) {
    console.warn('Usage limit check unavailable — allowing request without it', {
      type: err instanceof Error ? err.constructor.name : typeof err,
    })
    return { allowed: true }
  }
}

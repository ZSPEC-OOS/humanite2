import { PRICING_TIERS } from './pricing'

// The reusable account-tier capability model. `tier` itself is not new —
// it's the same field auth-utils.ts has always signed into the access
// token and usageLimits.ts has always metered against (see user.tier in
// Firestore, set at registration in userRegistration.ts and re-read on
// every login/refresh). What's new is `gold`: a distinct, administratively
// assigned account tier that is NOT one of the purchasable pricing plans
// in pricing.ts (no Stripe price, never self-serve, never shown on the
// public /pricing page) but carries full product entitlement — every
// consumer of `tier` (scope grants, usage quotas, UI labels) is extended
// to recognize it rather than a parallel "isGold" flag being threaded
// through separately.
//
// Granting Gold to an account works either of two ways:
//  1. A data change: set that account's Firestore `users/{id}.tier` field
//     to GOLD_TIER (see scripts/setAccountTier.ts) — needs write access to
//     the production database.
//  2. A code change: add the account's email to GOLD_EMAILS below and
//     deploy — needs no database access at all, since resolveEffectiveTier
//     overrides whatever `tier` is stored the moment a token is issued.
// Either way, every layer downstream (usage limits, scopes, UI) reads the
// resulting tier the same way and doesn't need to know which path was used.
export const GOLD_TIER = 'gold' as const

// Accounts that are always Gold regardless of their stored `tier` — see
// resolveEffectiveTier below. Exists specifically so granting Gold never
// requires database credentials: shipping a change to this list is an
// ordinary code change + deploy, the same as any other product change.
// Keep this list short and add a code comment naming who requested each
// entry and when — it's an allowlist of real accounts, not a feature flag.
const GOLD_EMAILS = new Set<string>([
  'jdzelazny@gmail.com',
])

// Every tier value this account can legitimately carry — the purchasable
// plans from pricing.ts, plus the administratively-assigned Gold tier.
export const ACCOUNT_TIERS: readonly string[] = [
  ...PRICING_TIERS.map(t => t.id),
  GOLD_TIER,
]

// The single authoritative check for "this account has unrestricted,
// unmetered access to the product" — consumed by usageLimits.ts (bypasses
// daily generation/scan quotas entirely), auth-utils.ts (grants at least
// the same scopes the top paid tiers get), and the account UI (renders the
// Gold badge in place of the plan badge). Adding another Gold user later
// means setting their stored `tier` to GOLD_TIER — nothing here changes.
export function isGoldTier(tier: string | null | undefined): boolean {
  return tier === GOLD_TIER
}

// The tier to actually sign into an access token for this account — call
// this at every token-issuance site (login, register, refresh), passing
// the account's own stored `tier`. Both arguments must come from a
// trusted, server-side source (the verified Firestore user record, or a
// registration this request itself just created) — never from a
// client-supplied value. A GOLD_EMAILS match always wins over whatever
// tier is stored, so hardcoding an email here is sufficient on its own;
// it does not also require updating that account's database record.
export function resolveEffectiveTier(email: string, storedTier: string): string {
  if (GOLD_EMAILS.has(email.trim().toLowerCase())) return GOLD_TIER
  return storedTier
}

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
// Granting Gold to an account is a data change, not a code change: set
// this account's Firestore `users/{id}.tier` field to GOLD_TIER (see
// scripts/setAccountTier.ts) and every layer below picks it up the next
// time that account logs in or refreshes its access token.
export const GOLD_TIER = 'gold' as const

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

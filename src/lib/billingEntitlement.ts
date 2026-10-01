import type Stripe from 'stripe'
import type { Firestore } from 'firebase-admin/firestore'
import { PRICING_TIERS } from './pricing'
import { isGoldTier } from './accountTier'

// Resolves a Stripe Price ID back to this deployment's internal tier id, by
// matching against the SAME env vars checkout/route.ts reads to build the
// session in the first place (see pricing.ts's `stripePriceEnvVar`). Read
// fresh on every call (no module-load caching) so a rotated Price ID takes
// effect without a redeploy/restart — matching usageLimits.ts's
// envOverride() pattern. Deliberately price-based rather than trusting a
// subscription's own stored `metadata.plan`: a plan change made through
// Stripe's customer portal (upgrade/downgrade) updates the subscription's
// price immediately but will NOT retroactively rewrite metadata set at
// checkout time, so the price itself is the only value guaranteed to
// reflect what the customer is CURRENTLY paying for.
export function tierForPriceId(priceId: string | null | undefined): string | null {
  if (!priceId) return null
  for (const tier of PRICING_TIERS) {
    if (!tier.stripePriceEnvVar) continue
    if (process.env[tier.stripePriceEnvVar] === priceId) return tier.id
  }
  return null
}

export interface ResolvedEntitlement {
  userId: string | null
  tier: string | null
}

// checkout.session.completed fires once, right after the FIRST successful
// payment for a brand-new subscription — the session itself is the most
// reliable place to read which tier the customer explicitly chose to check
// out for (we set both `metadata.userId`/`metadata.plan` ourselves at
// session creation — see checkout/route.ts). `client_reference_id` is kept
// as a fallback for a session created before that metadata existed.
export function resolveEntitlementFromCheckoutSession(session: Stripe.Checkout.Session): ResolvedEntitlement {
  const metadata = (session.metadata ?? {}) as Record<string, string | undefined>
  const userId = metadata.userId ?? session.client_reference_id ?? null
  const tier = metadata.plan ?? null
  return { userId, tier }
}

// customer.subscription.updated fires on every change to an existing
// subscription, including a plan change made through Stripe's customer
// portal rather than this app's own checkout flow — so the subscription's
// CURRENT price (not its metadata, which reflects only the plan chosen at
// original checkout) is the primary source of truth for which tier it now
// represents. `metadata.plan` (propagated from checkout/route.ts's
// `subscription_data.metadata`) is used only as a fallback if the price
// can't be matched to a known tier (e.g. a Price ID env var was rotated
// without updating the still-active subscription).
export function resolveEntitlementFromSubscription(subscription: Stripe.Subscription): ResolvedEntitlement {
  const metadata = (subscription.metadata ?? {}) as Record<string, string | undefined>
  const userId = metadata.userId ?? null
  const priceId = subscription.items?.data?.[0]?.price?.id ?? null
  const tier = tierForPriceId(priceId) ?? metadata.plan ?? null
  return { userId, tier }
}

export interface ApplyEntitlementParams {
  /** Stripe event id — enforced unique so webhook replay never double-applies a transition. */
  eventId: string
  userId: string
  /** The tier to set — 'free' for a cancelled/expired subscription. */
  tier: string
}

export type ApplyEntitlementOutcome = 'applied' | 'duplicate_event' | 'user_not_found' | 'gold_protected'

export interface ApplyEntitlementResult {
  applied: boolean
  outcome: ApplyEntitlementOutcome
}

const PROCESSED_EVENTS_COLLECTION = 'stripeProcessedEvents'

// The one place a Stripe billing event is allowed to change
// `users/{userId}.tier` — transactional so a webhook replay (Stripe retries
// delivery until it gets a 2xx, which can mean the same event arrives more
// than once) can never apply the same transition twice, and a Gold account
// (an administratively-assigned tier — see accountTier.ts) can never be
// silently downgraded by an ordinary subscription event. Both the
// idempotency record and the user-tier write happen in the same
// transaction, so a crash between them can't leave the event marked
// processed without the write actually having landed (or vice versa).
export async function applySubscriptionEntitlement(firestore: Firestore, params: ApplyEntitlementParams): Promise<ApplyEntitlementResult> {
  const { eventId, userId, tier } = params
  return firestore.runTransaction(async (tx) => {
    const eventRef = firestore.collection(PROCESSED_EVENTS_COLLECTION).doc(eventId)
    const eventSnap = await tx.get(eventRef)
    if (eventSnap.exists) {
      return { applied: false, outcome: 'duplicate_event' as const }
    }

    const userRef = firestore.collection('users').doc(userId)
    const userSnap = await tx.get(userRef)
    if (!userSnap.exists) {
      tx.set(eventRef, { eventId, userId, tier, outcome: 'user_not_found', processedAt: new Date() })
      return { applied: false, outcome: 'user_not_found' as const }
    }

    const currentTier = (userSnap.data() as { tier?: string } | undefined)?.tier
    if (isGoldTier(currentTier)) {
      tx.set(eventRef, { eventId, userId, tier, outcome: 'gold_protected', processedAt: new Date() })
      return { applied: false, outcome: 'gold_protected' as const }
    }

    tx.update(userRef, { tier, updatedAt: new Date() })
    tx.set(eventRef, { eventId, userId, tier, outcome: 'applied', processedAt: new Date() })
    return { applied: true, outcome: 'applied' as const }
  })
}

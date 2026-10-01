import { NextRequest, NextResponse } from 'next/server'
import type Stripe from 'stripe'
import { getStripe } from '@/lib/stripe'
import { db, tryPersist } from '@/lib/firestore'
import {
  applySubscriptionEntitlement,
  resolveEntitlementFromCheckoutSession,
  resolveEntitlementFromSubscription,
} from '@/lib/billingEntitlement'

// Resolves each relevant Stripe event to a real account-tier change and
// applies it via billingEntitlement.ts's idempotent, Gold-protected
// transaction. This DOES unlock the purchased tier for the buyer — real
// per-user accounts, JWT auth, and per-user usage accounting are already in
// place (see require-auth.ts, auth-utils.ts, usageLimits.ts); a stale
// earlier version of this comment claimed otherwise, back when
// requireAuth() had no real login to attach a subscription to. It has one
// now, and this route is the live entitlement path, not a placeholder log.
//
// Register this URL (https://<your-domain>/api/v1/billing/webhook) in the
// Stripe dashboard once STRIPE_SECRET_KEY is set, and copy the signing
// secret it gives you into STRIPE_WEBHOOK_SECRET.

const RELEVANT_EVENTS = new Set([
  'checkout.session.completed',
  'customer.subscription.updated',
  'customer.subscription.deleted',
])

// checkout.session.completed / customer.subscription.updated resolve a
// userId + tier directly from the event; customer.subscription.deleted
// always resolves to 'free' regardless of which tier the cancelled
// subscription was for — a lapsed/cancelled subscription downgrades to the
// free plan, never leaves the account on its old paid tier.
function resolveEntitlement(event: Stripe.Event): { userId: string | null; tier: string | null } {
  switch (event.type) {
    case 'checkout.session.completed':
      return resolveEntitlementFromCheckoutSession(event.data.object as Stripe.Checkout.Session)
    case 'customer.subscription.updated':
      return resolveEntitlementFromSubscription(event.data.object as Stripe.Subscription)
    case 'customer.subscription.deleted': {
      const { userId } = resolveEntitlementFromSubscription(event.data.object as Stripe.Subscription)
      return { userId, tier: 'free' }
    }
    default:
      return { userId: null, tier: null }
  }
}

export async function POST(req: NextRequest) {
  const signature = req.headers.get('stripe-signature')
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET

  if (!signature || !webhookSecret) {
    return NextResponse.json(
      { error: { code: 'WEBHOOK_NOT_CONFIGURED', message: 'STRIPE_WEBHOOK_SECRET is not set.' } },
      { status: 503 },
    )
  }

  const rawBody = await req.text()

  let event: Stripe.Event
  try {
    event = getStripe().webhooks.constructEvent(rawBody, signature, webhookSecret)
  } catch (err) {
    console.warn('Stripe webhook signature verification failed', {
      type: err instanceof Error ? err.constructor.name : typeof err,
    })
    return NextResponse.json(
      { error: { code: 'INVALID_SIGNATURE', message: 'Webhook signature verification failed.' } },
      { status: 400 },
    )
  }

  if (!RELEVANT_EVENTS.has(event.type)) {
    return NextResponse.json({ received: true })
  }

  // Durable raw-event log, independent of entitlement outcome — kept for
  // audit/reconciliation even if entitlement application below fails or is
  // skipped (e.g. an event Stripe sends for a subscription this app never
  // attached a userId to).
  await tryPersist(() => db().collection('billing_events').add({
    type: event.type,
    stripeEventId: event.id,
    data: event.data.object,
    receivedAt: new Date(),
  }), 'persist billing event')

  const { userId, tier } = resolveEntitlement(event)

  if (!userId || !tier) {
    console.warn('Stripe webhook event could not be attributed to a user/tier — no entitlement change applied', {
      type: event.type,
      stripeEventId: event.id,
      hasUserId: Boolean(userId),
      hasTier: Boolean(tier),
    })
    return NextResponse.json({ received: true })
  }

  try {
    const result = await applySubscriptionEntitlement(db(), { eventId: event.id, userId, tier })
    if (!result.applied && result.outcome !== 'duplicate_event') {
      console.warn('Stripe webhook entitlement not applied', {
        type: event.type,
        stripeEventId: event.id,
        userId,
        tier,
        outcome: result.outcome,
      })
    }
  } catch (err) {
    console.error('Stripe webhook entitlement update failed', {
      type: event.type,
      stripeEventId: event.id,
      errorType: err instanceof Error ? err.constructor.name : typeof err,
    })
    // Returning non-2xx tells Stripe to retry delivery — entitlement
    // application is idempotent (see applySubscriptionEntitlement), so a
    // retry is safe and is the correct response to a transient failure
    // (e.g. a Firestore blip) rather than silently dropping the event.
    return NextResponse.json(
      { error: { code: 'ENTITLEMENT_UPDATE_FAILED', message: 'Could not apply billing entitlement; Stripe will retry.' } },
      { status: 500 },
    )
  }

  return NextResponse.json({ received: true })
}

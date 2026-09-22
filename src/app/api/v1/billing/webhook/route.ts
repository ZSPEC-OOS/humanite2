import { NextRequest, NextResponse } from 'next/server'
import { getStripe } from '@/lib/stripe'
import { db, tryPersist } from '@/lib/firestore'

// Records raw Stripe billing events (checkout completed, subscription
// changed/cancelled) for later reconciliation — it does NOT unlock a tier
// for anyone yet. There's no real per-user account to attach a
// subscription to until requireAuth() enforces actual login (see
// src/lib/require-auth.ts); until then this is a durable log to reconcile
// against once that's in place, not a live entitlement system.
//
// Register this URL (https://<your-domain>/api/v1/billing/webhook) in the
// Stripe dashboard once STRIPE_SECRET_KEY is set, and copy the signing
// secret it gives you into STRIPE_WEBHOOK_SECRET.

const RELEVANT_EVENTS = new Set([
  'checkout.session.completed',
  'customer.subscription.updated',
  'customer.subscription.deleted',
])

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

  let event
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

  if (RELEVANT_EVENTS.has(event.type)) {
    await tryPersist(() => db().collection('billing_events').add({
      type: event.type,
      stripeEventId: event.id,
      data: event.data.object,
      receivedAt: new Date(),
    }), 'persist billing event')
  }

  return NextResponse.json({ received: true })
}

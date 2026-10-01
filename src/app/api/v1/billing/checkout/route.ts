import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, isAuthFailure } from '@/lib/require-auth'
import { getStripe } from '@/lib/stripe'
import { PRICING_TIERS } from '@/lib/pricing'

// Creates a Stripe-hosted Checkout session for a paid tier and hands the
// client its URL to redirect to. This is the actual integration point:
// once STRIPE_SECRET_KEY and the tier's Price ID env var are set in the
// deployment, this works end-to-end with no further code changes needed.
//
// This DOES unlock the purchased tier for the buyer: `metadata.userId`/
// `metadata.plan` are stamped on both the Checkout Session AND the
// subscription it creates (`subscription_data.metadata`), which is what the
// webhook route (../webhook/route.ts) reads to resolve `checkout.session.
// completed`/`customer.subscription.updated`/`customer.subscription.deleted`
// events back to a real `users/{userId}.tier` change via
// billingEntitlement.ts. `client_reference_id` is also set for visibility in
// the Stripe dashboard, but the metadata fields are what entitlement
// resolution actually reads.
//
// Free has no Stripe price at all and is never checked out through here —
// a Free account is created by ordinary registration (see
// src/lib/userRegistration.ts / POST /api/v1/auth/register).

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if (isAuthFailure(auth)) return auth

  let body: { plan?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } },
      { status: 400 },
    )
  }

  if (body.plan === 'free') {
    return NextResponse.json(
      {
        error: {
          code: 'FREE_PLAN_NO_CHECKOUT',
          message: 'Free has no checkout — create an account via registration to start on the Free plan.',
        },
      },
      { status: 400 },
    )
  }

  const tier = PRICING_TIERS.find(t => t.id === body.plan)
  const priceId = tier?.stripePriceEnvVar ? process.env[tier.stripePriceEnvVar] : undefined

  if (!tier || !tier.stripePriceEnvVar || !priceId) {
    return NextResponse.json(
      {
        error: {
          code: 'PLAN_NOT_AVAILABLE_FOR_CHECKOUT',
          message: tier
            ? `Checkout for '${tier.id}' is not configured — set ${tier.stripePriceEnvVar} to enable it.`
            : `Unknown plan: ${body.plan}.`,
        },
      },
      { status: 400 },
    )
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin

  try {
    const stripe = getStripe()
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: auth.claims.sub,
      metadata: { userId: auth.claims.sub, plan: tier.id },
      subscription_data: { metadata: { userId: auth.claims.sub, plan: tier.id } },
      success_url: `${appUrl}/dashboard?checkout=success`,
      cancel_url: `${appUrl}/pricing?checkout=cancelled`,
    })

    if (!session.url) {
      throw new Error('Stripe did not return a checkout URL')
    }
    return NextResponse.json({ url: session.url })
  } catch (err) {
    console.error('Stripe checkout session creation failed', {
      type: err instanceof Error ? err.constructor.name : typeof err,
    })
    return NextResponse.json(
      {
        error: {
          code: 'BILLING_UNAVAILABLE',
          message: 'Payments are not configured yet. Set STRIPE_SECRET_KEY to enable checkout.',
        },
      },
      { status: 503 },
    )
  }
}

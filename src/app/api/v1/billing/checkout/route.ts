import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, isAuthFailure } from '@/lib/require-auth'
import { getStripe } from '@/lib/stripe'
import { PRICING_TIERS } from '@/lib/pricing'

// Creates a Stripe-hosted Checkout session for a paid tier and hands the
// client its URL to redirect to. This is the actual integration point:
// once STRIPE_SECRET_KEY and the tier's Price ID env var are set in the
// deployment, this works end-to-end with no further code changes needed.
//
// What this deliberately does NOT do: unlock the purchased tier for the
// buyer. requireAuth() currently treats every request as the same fixed
// "local" identity (see src/lib/require-auth.ts) — there is no real
// per-user account yet to attach a subscription to. The webhook route
// (../webhook/route.ts) records the raw Stripe events for later
// reconciliation once real auth exists; wiring a completed checkout to an
// actual tier upgrade is follow-up work, not something this endpoint fakes.

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

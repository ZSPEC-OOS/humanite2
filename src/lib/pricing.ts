// Single source of truth for pricing tiers — the /pricing page renders from
// this, and the Stripe checkout route (src/app/api/v1/billing/checkout)
// looks up each paid tier's Price ID by `stripePriceEnvVar`. Add a tier here
// and both stay in sync.
//
// Internal id -> public name:
//   free       -> Free        ($0, no checkout — see registerUser). A
//                               one-time 30-day trial from account creation,
//                               not a recurring monthly plan — see
//                               usageLimits.ts's checkAndRecordFreeTrialUsage.
//   starter    -> Starter     ($5)
//   pro        -> Pro         ($10)
//   enterprise -> Max         ($15 — kept as 'enterprise' internally for
//                               backward compatibility; never displayed to
//                               users as "Enterprise")
// 'gold' is a distinct, administratively-assigned tier (see accountTier.ts)
// and deliberately does not appear in this list — it has no price, is never
// self-serve, and is never shown on the public pricing page.

export interface PricingTier {
  id: 'free' | 'starter' | 'pro' | 'enterprise'
  name: string
  price: string
  period: string
  description: string
  features: string[]
  cta: string
  /** Static destination — used by tiers with no checkout (Free). */
  ctaHref?: string
  /** Env var holding this tier's Stripe Price ID — used by tiers that checkout. */
  stripePriceEnvVar?: string
  highlighted?: boolean
}

export const PRICING_TIERS: PricingTier[] = [
  {
    id: 'free',
    name: 'Free',
    price: '$0',
    period: '30-day trial',
    description: 'Try Humanite free for 30 days.',
    features: [
      '1,200 generated words (one-time, over 30 days)',
      '1,200 scanned words (one-time, over 30 days)',
      'Humanize up to 300 words per request',
      'All tones & domains',
      'Standard quality gates',
      'Export to TXT, Markdown, or Word',
      'Bring your own compatible AI model',
    ],
    cta: 'Start Free Trial',
    ctaHref: '/auth/register',
  },
  {
    id: 'starter',
    name: 'Starter',
    price: '$5',
    period: '/month',
    description: 'For everyday writing with real detection coverage.',
    features: [
      'Everything in Free',
      '50,000 generated words / month',
      '50,000 scanned words / month',
      'Humanize up to 24,000 characters per request',
      'All tones & domains',
      'Standard quality gates (fact preservation, meaning check)',
      'Export to TXT, Markdown, or Word',
    ],
    cta: 'Upgrade to Starter',
    stripePriceEnvVar: 'STRIPE_PRICE_ID_STARTER',
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '$10',
    period: '/month',
    description: 'For serious writing, every day.',
    features: [
      'Everything in Starter',
      '100,000 generated words / month',
      '100,000 scanned words / month',
      'Long documents up to 200,000 characters',
      'Background processing with automatic progress recovery',
      'Saved presets',
      'Bring your own AI model, synced across devices',
      'Priority support',
    ],
    cta: 'Upgrade to Pro',
    stripePriceEnvVar: 'STRIPE_PRICE_ID_PRO',
    highlighted: true,
  },
  {
    id: 'enterprise',
    name: 'Max',
    price: '$15',
    period: '/month',
    description: 'For power users who write and check the most.',
    features: [
      'Everything in Pro',
      '150,000 generated words / month',
      '150,000 scanned words / month',
      'Highest generation & scan quotas on the platform',
    ],
    cta: 'Upgrade to Max',
    stripePriceEnvVar: 'STRIPE_PRICE_ID_MAX',
  },
]

// Single source of truth for pricing tiers — the /pricing page renders from
// this, and the Stripe checkout route (src/app/api/v1/billing/checkout)
// looks up each paid tier's Price ID by `stripePriceEnvVar`. Add a tier here
// and both stay in sync.

export interface PricingTier {
  id: 'free' | 'pro' | 'enterprise'
  name: string
  price: string
  period: string
  description: string
  features: string[]
  cta: string
  /** Static destination — used by tiers with no checkout (Free, Enterprise). */
  ctaHref?: string
  /** Env var holding this tier's Stripe Price ID — used by tiers that checkout. */
  stripePriceEnvVar?: string
  highlighted?: boolean
}

export const PRICING_TIERS: PricingTier[] = [
  {
    id: 'free',
    name: 'Starter',
    price: '$5',
    period: '/month',
    description: 'For everyday writing with real detection coverage.',
    features: [
      '50,000 generated words / month',
      '50,000 scanned words / month',
      'Humanize up to 24,000 characters per request',
      'All tones & domains',
      'Standard quality gates (fact preservation, meaning check)',
      'Export to TXT, Markdown, or Word',
    ],
    cta: 'Get Started',
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

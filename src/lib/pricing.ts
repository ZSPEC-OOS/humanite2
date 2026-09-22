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
    name: 'Free',
    price: '$0',
    period: 'forever',
    description: 'For trying Humanite out.',
    features: [
      'Humanize up to 24,000 characters per request',
      'Unlimited quick scans',
      'All tones & domains',
      'Standard quality gates (fact preservation, meaning check)',
      'Export to TXT, Markdown, or Word',
    ],
    cta: 'Get Started',
    ctaHref: '/dashboard',
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '$19',
    period: '/month',
    description: 'For serious writing, every day.',
    features: [
      'Everything in Free',
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
    name: 'Enterprise',
    price: 'Custom',
    period: '',
    description: 'For teams and organizations.',
    features: [
      'Everything in Pro',
      'Custom usage limits',
      'Team seats & shared presets',
      'Dedicated support & onboarding',
      'Custom model/provider integration',
    ],
    cta: 'Contact Sales',
    ctaHref: 'mailto:sales@humanite.app',
  },
]

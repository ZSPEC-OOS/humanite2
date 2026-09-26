import Link from 'next/link'
import { SiteNav } from '@/components/marketing/SiteNav'
import { SiteFooter } from '@/components/marketing/SiteFooter'
import { CheckoutButton } from '@/components/marketing/CheckoutButton'
import { CheckIcon } from '@/components/marketing/icons'
import { PRICING_TIERS } from '@/lib/pricing'

const FAQS = [
  {
    q: 'Can I use my own AI model instead of the built-in one?',
    a: 'Yes — every plan supports bringing your own OpenAI-compatible API key (OpenAI, DeepSeek, or a self-hosted model). Pro and Max sync that configuration across your devices.',
  },
  {
    q: 'What happens to text longer than my plan’s limit?',
    a: 'Starter processes documents synchronously up to 24,000 characters per request. Pro and Max raise that to 200,000 characters, processed as a background job with automatic progress recovery if it runs long.',
  },
  {
    q: 'What are generated and scanned words?',
    a: 'Generated words are what Humanize rewrites for you each month. Scanned words are what our AI-detection check can review each month — every plan gets an equal amount of both, so you can always verify what you generate.',
  },
  {
    q: 'Is there a free trial?',
    a: 'No — all three plans are paid from the first day. Starter is the lowest-cost way to try Humanize with real generation and detection quotas.',
  },
  {
    q: 'Can I cancel anytime?',
    a: 'Yes — every plan is billed monthly with no long-term contract.',
  },
]

export default function PricingPage() {
  return (
    <main className="min-h-screen bg-white dark:bg-gray-950">
      <div className="flex min-h-screen flex-col">
        <SiteNav />

        <div className="flex-1 px-6 pb-20 pt-6 md:px-14">
          {/* Hero */}
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-gray-500 dark:text-gray-400">
              Simple pricing
            </p>
            <h1 className="mt-4 font-display text-4xl font-bold text-gray-900 dark:text-gray-100 md:text-6xl">
              Pay for what you write
            </h1>
            <p className="mx-auto mt-4 max-w-lg text-base leading-relaxed text-gray-600 dark:text-gray-400 md:text-lg">
              Every plan includes equal generated and scanned words each month. Upgrade for more of both, longer documents, and saved presets.
            </p>
          </div>

          {/* Tier cards */}
          <div className="mx-auto mt-14 grid max-w-5xl gap-6 md:grid-cols-3">
            {PRICING_TIERS.map(tier => (
              <div
                key={tier.id}
                className={`relative flex flex-col rounded-2xl border bg-white p-7 dark:bg-gray-900 ${
                  tier.highlighted ? 'border-gray-900 dark:border-gray-100 md:-translate-y-2' : 'border-gray-200 dark:border-gray-800'
                }`}
              >
                {tier.highlighted && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-gray-900
                                   px-3 py-1 text-xs font-bold text-white dark:bg-gray-100 dark:text-gray-900">
                    Most popular
                  </span>
                )}

                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{tier.name}</h2>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{tier.description}</p>

                <div className="mt-5 flex items-baseline gap-1">
                  <span className="font-display text-4xl font-bold text-gray-900 dark:text-gray-100">{tier.price}</span>
                  {tier.period && <span className="text-sm text-gray-500 dark:text-gray-400">{tier.period}</span>}
                </div>

                <ul className="mt-6 flex-1 space-y-3">
                  {tier.features.map(f => (
                    <li key={f} className="flex items-start gap-2.5 text-sm text-gray-600 dark:text-gray-400">
                      <CheckIcon className="mt-0.5 shrink-0 text-gray-900 dark:text-gray-100" />
                      {f}
                    </li>
                  ))}
                </ul>

                <div className="mt-8">
                  {tier.stripePriceEnvVar ? (
                    <CheckoutButton
                      plan={tier.id}
                      className="w-full rounded-full bg-gray-900 px-6 py-3 text-sm font-bold text-white
                                 transition-colors hover:bg-gray-800 disabled:opacity-60
                                 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white"
                    >
                      {tier.cta}
                    </CheckoutButton>
                  ) : (
                    <Link
                      href={tier.ctaHref ?? '#'}
                      className="block w-full rounded-full bg-gray-900 px-6 py-3 text-center text-sm
                                 font-semibold text-white transition-colors hover:bg-gray-800
                                 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white"
                    >
                      {tier.cta}
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* FAQ */}
          <div className="mx-auto mt-20 max-w-2xl">
            <h2 className="text-center font-display text-2xl font-bold text-gray-900 dark:text-gray-100 md:text-3xl">
              Questions, answered
            </h2>
            <div className="mt-8 space-y-4">
              {FAQS.map(item => (
                <div key={item.q} className="rounded-2xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
                  <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{item.q}</p>
                  <p className="mt-1.5 text-sm leading-relaxed text-gray-600 dark:text-gray-400">{item.a}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <SiteFooter />
      </div>
    </main>
  )
}

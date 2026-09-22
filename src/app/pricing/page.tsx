import Link from 'next/link'
import { SiteNav } from '@/components/marketing/SiteNav'
import { SiteFooter } from '@/components/marketing/SiteFooter'
import { PageBackground } from '@/components/marketing/PageBackground'
import { CheckoutButton } from '@/components/marketing/CheckoutButton'
import { CheckIcon } from '@/components/marketing/icons'
import { PRICING_TIERS } from '@/lib/pricing'

const FAQS = [
  {
    q: 'Can I use my own AI model instead of the built-in one?',
    a: 'Yes — every plan supports bringing your own OpenAI-compatible API key (OpenAI, DeepSeek, or a self-hosted model). Pro syncs that configuration across your devices.',
  },
  {
    q: 'What happens to text longer than my plan’s limit?',
    a: 'Free processes documents synchronously up to 24,000 characters per request. Pro raises that to 200,000 characters, processed as a background job with automatic progress recovery if it runs long.',
  },
  {
    q: 'Is there a free trial for Pro?',
    a: 'The Free plan has no time limit, so you can try the core tool for as long as you like before upgrading for longer documents and saved presets.',
  },
  {
    q: 'Can I cancel anytime?',
    a: 'Yes, Pro is billed monthly with no long-term contract.',
  },
]

export default function PricingPage() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-white">
      <PageBackground />

      <div className="relative z-10 flex min-h-screen flex-col">
        <SiteNav />

        <div className="flex-1 px-6 pb-20 pt-6 md:px-14">
          {/* Hero */}
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-gray-500">
              Simple pricing
            </p>
            <h1 className="mt-4 font-display text-4xl font-bold text-gray-900 md:text-6xl">
              Pay for what you write
            </h1>
            <p className="mx-auto mt-4 max-w-lg text-base leading-relaxed text-gray-600 md:text-lg">
              Start free. Upgrade when you need longer documents, saved presets, and priority support.
            </p>
          </div>

          {/* Tier cards */}
          <div className="mx-auto mt-14 grid max-w-5xl gap-6 md:grid-cols-3">
            {PRICING_TIERS.map(tier => (
              <div
                key={tier.id}
                className={`relative flex flex-col rounded-2xl border bg-white/90 p-7 shadow-lg shadow-black/5 backdrop-blur-md ${
                  tier.highlighted ? 'border-orange-300 md:-translate-y-2 md:shadow-xl' : 'border-white/60'
                }`}
              >
                {tier.highlighted && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-gradient-to-r
                                   from-orange-500 to-red-500 px-3 py-1 text-xs font-bold text-white">
                    Most popular
                  </span>
                )}

                <h2 className="text-lg font-semibold text-gray-900">{tier.name}</h2>
                <p className="mt-1 text-sm text-gray-500">{tier.description}</p>

                <div className="mt-5 flex items-baseline gap-1">
                  <span className="font-display text-4xl font-bold text-gray-900">{tier.price}</span>
                  {tier.period && <span className="text-sm text-gray-500">{tier.period}</span>}
                </div>

                <ul className="mt-6 flex-1 space-y-3">
                  {tier.features.map(f => (
                    <li key={f} className="flex items-start gap-2.5 text-sm text-gray-600">
                      <CheckIcon className="mt-0.5 shrink-0 text-green-600" />
                      {f}
                    </li>
                  ))}
                </ul>

                <div className="mt-8">
                  {tier.stripePriceEnvVar ? (
                    <CheckoutButton
                      plan={tier.id}
                      className="w-full rounded-full bg-gradient-to-r from-orange-500 to-red-500
                                 px-6 py-3 text-sm font-bold text-white shadow-md shadow-orange-500/25
                                 transition-transform hover:scale-[1.02] active:scale-[0.98] disabled:opacity-60"
                    >
                      {tier.cta}
                    </CheckoutButton>
                  ) : (
                    <Link
                      href={tier.ctaHref ?? '#'}
                      className="block w-full rounded-full bg-gray-900 px-6 py-3 text-center text-sm
                                 font-semibold text-white transition-colors hover:bg-gray-800"
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
            <h2 className="text-center font-display text-2xl font-bold text-gray-900 md:text-3xl">
              Questions, answered
            </h2>
            <div className="mt-8 space-y-4">
              {FAQS.map(item => (
                <div key={item.q} className="rounded-2xl border border-white/60 bg-white/85 p-5 shadow-sm backdrop-blur-md">
                  <p className="text-sm font-semibold text-gray-900">{item.q}</p>
                  <p className="mt-1.5 text-sm leading-relaxed text-gray-600">{item.a}</p>
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

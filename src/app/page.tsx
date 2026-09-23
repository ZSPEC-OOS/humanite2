import Image from 'next/image'
import Link from 'next/link'
import { SiteNav } from '@/components/marketing/SiteNav'
import { SiteFooter } from '@/components/marketing/SiteFooter'
import { ArrowIcon } from '@/components/marketing/icons'

function AIIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="5" y="7" width="14" height="11" rx="3" stroke="#111827" strokeWidth="1.4" />
      <path d="M12 3v4M8.5 12h.01M15.5 12h.01" stroke="#111827" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M2 12h3M19 12h3" stroke="#111827" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

function HumanIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="8" r="3.5" stroke="#111827" strokeWidth="1.4" />
      <path d="M4.5 20c1.4-4 4-6 7.5-6s6.1 2 7.5 6" stroke="#111827" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

const AI_TEXT = `Artificial intelligence is transforming the way we work, learn, and communicate. It has the potential to increase efficiency, automate tasks, and unlock new opportunities across various industries.`

const HUMAN_TEXT = `AI is changing how we work, learn, and connect. It helps us get more done, takes care of the repetitive stuff, and opens the door to new opportunities across all kinds of industries.`

const FEATURES = [
  { icon: '⚡', label: 'More human writing' },
  { icon: '👥', label: 'For creators, students & teams' },
  { icon: '📊', label: 'Real ideas. Real impact.' },
  { icon: '🤍', label: 'A kinder internet' },
]

export default function LandingPage() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-white">
      <Image
        src="/images/BlankHomescreenBackground.PNG"
        alt=""
        fill
        priority
        sizes="100vw"
        className="hidden object-contain object-top md:block"
        aria-hidden
      />
      <Image
        src="/images/HomepageIphoneBackground.PNG"
        alt=""
        fill
        priority
        sizes="100vw"
        className="object-cover md:hidden"
        aria-hidden
      />

      <div className="relative z-10 flex min-h-screen flex-col">
        <SiteNav />

        {/* Hero */}
        <div className="flex flex-1 flex-col items-center px-6 pb-16 pt-4 text-center md:pt-6">
          <p
            data-edit-id="hero-eyebrow"
            className="text-[11px] font-semibold uppercase tracking-[0.28em] text-gray-500"
          >
            More human ideas for a brighter tomorrow
          </p>

          <Image
            data-edit-id="hero-headline"
            src="/images/Logotrans.png"
            alt="Humanite"
            width={1448}
            height={1043}
            priority
            className="mt-5 h-auto w-[280px] md:w-[440px]"
          />

          <p
            data-edit-id="hero-subhead"
            className="mt-5 font-display text-3xl text-gray-900 md:text-5xl"
          >
            Make AI Writing Sound <em className="italic">Human.</em>
          </p>

          <p
            data-edit-id="hero-description"
            className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-gray-600 md:text-lg"
          >
            Humanite converts AI-generated text into natural, human-sounding writing
            — so your ideas feel real, relatable, and uniquely yours.
          </p>

          <Link
            href="/dashboard"
            data-edit-id="hero-cta"
            className="mt-8 inline-flex items-center gap-2.5 rounded-full bg-gradient-to-r from-orange-500 to-red-500
                       px-8 py-4 text-base font-bold text-white shadow-lg shadow-orange-500/25
                       transition-transform hover:scale-[1.02] active:scale-[0.98]"
          >
            Begin Transformation
            <ArrowIcon />
          </Link>

          {/* Comparison cards */}
          <div
            data-edit-id="comparison-row"
            className="relative mx-auto mt-12 grid w-full max-w-4xl gap-4 md:grid-cols-2"
          >
            <div data-edit-id="ai-card" className="rounded-2xl border border-white/60 bg-white/90 p-6 text-left shadow-lg shadow-black/5 backdrop-blur-md">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AIIcon />
                  <span className="text-sm font-semibold text-gray-900">AI Text</span>
                </div>
                <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-500">
                  Generic
                </span>
              </div>
              <p className="text-sm leading-relaxed text-gray-600">{AI_TEXT}</p>
            </div>

            <div data-edit-id="human-card" className="rounded-2xl border border-white/60 bg-white/90 p-6 text-left shadow-lg shadow-black/5 backdrop-blur-md">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <HumanIcon />
                  <span className="text-sm font-semibold text-gray-900">Human Text</span>
                </div>
                <span className="flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-1 text-xs font-medium text-green-700">
                  More human +
                </span>
              </div>
              <p className="text-sm leading-relaxed text-gray-600">{HUMAN_TEXT}</p>
            </div>

            <div
              data-edit-id="comparison-swap-badge"
              className="pointer-events-none absolute left-1/2 top-1/2 hidden h-9 w-9 -translate-x-1/2
                            -translate-y-1/2 items-center justify-center rounded-full border border-white/60
                            bg-white/90 shadow-md backdrop-blur-md md:flex"
            >
              <ArrowIcon className="text-gray-700" />
            </div>
          </div>

          {/* Feature strip */}
          <div
            data-edit-id="feature-strip"
            className="mx-auto mt-10 flex max-w-4xl flex-wrap items-center justify-center gap-3"
          >
            {FEATURES.map((f, i) => (
              <span
                key={f.label}
                data-edit-id={`feature-pill-${i}`}
                className="flex items-center gap-1.5 rounded-full border border-white/60 bg-white/80
                           px-4 py-2 text-xs font-medium text-gray-700 shadow-sm backdrop-blur-md"
              >
                <span aria-hidden>{f.icon}</span>
                {f.label}
              </span>
            ))}
          </div>
        </div>

        <SiteFooter />
      </div>
    </main>
  )
}

import Image from 'next/image'
import Link from 'next/link'

function ArrowIcon({ className = '' }: { className?: string }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className={className} aria-hidden>
      <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.4"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

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

export default function LandingPage() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-white">
      <Image
        src="/images/homepage-hero.png"
        alt=""
        fill
        priority
        sizes="100vw"
        className="object-cover object-bottom"
        aria-hidden
      />

      <div className="relative z-10 flex min-h-screen flex-col">
        {/* Nav */}
        <header className="px-8 py-7 md:px-14 md:py-9">
          <span className="font-display text-xl text-gray-900">
            Humanite<sup className="text-[0.55em]">™</sup>
          </span>
        </header>

        {/* Hero */}
        <div className="flex flex-1 flex-col items-center px-6 pb-16 pt-2 text-center md:pt-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-gray-500">
            More human ideas for a brighter tomorrow
          </p>

          <h1 className="mt-5 font-display text-6xl font-bold leading-none text-gray-900 md:text-8xl">
            Humanite<sup className="text-[0.35em] align-super">™</sup>
          </h1>

          <p className="mt-4 font-display text-3xl text-gray-900 md:text-5xl">
            Make AI Writing Sound <em className="italic">Human.</em>
          </p>

          <p className="mx-auto mt-6 max-w-xl font-serif text-base leading-relaxed text-gray-600 md:text-lg">
            Humanite converts AI-generated text into natural, human-sounding writing
            — so your ideas feel real, relatable, and uniquely yours.
          </p>

          <Link
            href="/dashboard"
            className="mt-8 inline-flex items-center gap-2.5 rounded-full bg-gray-900 px-8 py-4
                       font-display text-base text-white transition-colors hover:bg-gray-800"
          >
            Begin Transformation
            <ArrowIcon />
          </Link>

          {/* Comparison cards */}
          <div className="relative mx-auto mt-12 grid w-full max-w-4xl gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-gray-200 bg-white/90 p-6 text-left shadow-sm backdrop-blur-sm">
              <div className="mb-3 flex items-center gap-2">
                <AIIcon />
                <span className="text-sm font-semibold text-gray-900">AI Text</span>
              </div>
              <p className="font-serif text-sm leading-relaxed text-gray-600">{AI_TEXT}</p>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white/90 p-6 text-left shadow-sm backdrop-blur-sm">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <HumanIcon />
                  <span className="text-sm font-semibold text-gray-900">Human Text</span>
                </div>
                <span className="rounded-full bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700">
                  More human
                </span>
              </div>
              <p className="font-serif text-sm leading-relaxed text-gray-600">{HUMAN_TEXT}</p>
            </div>

            <div className="pointer-events-none absolute left-1/2 top-1/2 hidden h-9 w-9 -translate-x-1/2
                            -translate-y-1/2 items-center justify-center rounded-full border border-gray-200
                            bg-white shadow-sm md:flex">
              <ArrowIcon className="text-gray-700" />
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}

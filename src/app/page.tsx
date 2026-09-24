import Link from 'next/link'
import { SiteNav } from '@/components/marketing/SiteNav'
import { SiteFooter } from '@/components/marketing/SiteFooter'
import { ArrowIcon } from '@/components/marketing/icons'

function AIIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden className="text-gray-900 dark:text-gray-100">
      <rect x="5" y="7" width="14" height="11" rx="3" stroke="currentColor" strokeWidth="1.4" />
      <path d="M12 3v4M8.5 12h.01M15.5 12h.01" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M2 12h3M19 12h3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

function HumanIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden className="text-gray-900 dark:text-gray-100">
      <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M4.5 20c1.4-4 4-6 7.5-6s6.1 2 7.5 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

const AI_TEXT = `Artificial intelligence is transforming the way we work, learn, and communicate. It has the potential to increase efficiency, automate tasks, and unlock new opportunities across various industries.`

const HUMAN_TEXT = `AI is changing how we work, learn, and connect. It helps us get more done, takes care of the repetitive stuff, and opens the door to new opportunities across all kinds of industries.`

const FEATURES = [
  'More human writing',
  'For creators, students & teams',
  'Real ideas. Real impact.',
  'A kinder internet',
]

export default function LandingPage() {
  return (
    <main className="relative min-h-screen bg-white dark:bg-gray-950">
      <div className="flex min-h-screen flex-col">
        <SiteNav />

        {/* Hero */}
        <div className="flex flex-1 flex-col items-center px-6 pb-16 pt-4 text-center md:pt-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-gray-500 dark:text-gray-400">
            From generated to genuine
          </p>

          <h1 className="mt-5 font-display text-5xl font-bold text-gray-900 dark:text-gray-100 md:text-7xl">
            Humanite
          </h1>

          <p className="mt-5 font-display text-3xl text-gray-900 dark:text-gray-100 md:text-5xl">
            Make AI Writing Sound <em className="italic">Human.</em>
          </p>

          <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-gray-600 dark:text-gray-400 md:text-lg">
            Humanite converts AI-generated text into natural, human-sounding writing
            — so your ideas feel real, relatable, and uniquely yours.
          </p>

          <Link
            href="/dashboard"
            className="mt-8 inline-flex items-center gap-2.5 rounded-full bg-gray-900
                       px-8 py-4 text-base font-bold text-white
                       transition-colors hover:bg-gray-800
                       dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white"
          >
            Begin Transformation
            <ArrowIcon />
          </Link>

          {/* Comparison cards */}
          <div className="relative mx-auto mt-12 grid w-full max-w-4xl gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-gray-200 bg-white p-6 text-left dark:border-gray-800 dark:bg-gray-900">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <AIIcon />
                  <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">AI Text</span>
                </div>
                <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                  Generic
                </span>
              </div>
              <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-400">{AI_TEXT}</p>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white p-6 text-left dark:border-gray-800 dark:bg-gray-900">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <HumanIcon />
                  <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">Human Text</span>
                </div>
                <span className="flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                  More human +
                </span>
              </div>
              <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-400">{HUMAN_TEXT}</p>
            </div>

            <div
              className="pointer-events-none absolute left-1/2 top-1/2 hidden h-9 w-9 -translate-x-1/2
                            -translate-y-1/2 items-center justify-center rounded-full border border-gray-200
                            bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900 md:flex"
            >
              <ArrowIcon className="text-gray-700 dark:text-gray-300" />
            </div>
          </div>

          {/* Feature strip */}
          <div className="mx-auto mt-10 flex max-w-4xl flex-wrap items-center justify-center gap-3">
            {FEATURES.map(label => (
              <span
                key={label}
                className="rounded-full border border-gray-200 bg-white
                           px-4 py-2 text-xs font-medium text-gray-700
                           dark:border-gray-800 dark:bg-gray-900 dark:text-gray-300"
              >
                {label}
              </span>
            ))}
          </div>
        </div>

        <SiteFooter />
      </div>
    </main>
  )
}

import Link from 'next/link'
import { SiteNav } from '@/components/marketing/SiteNav'
import { SiteFooter } from '@/components/marketing/SiteFooter'
import { PageBackground } from '@/components/marketing/PageBackground'
import { ArrowIcon } from '@/components/marketing/icons'

const FEATURES = [
  {
    icon: '🎚️',
    title: 'Intensity you control',
    description: 'A single slider from light touch-ups to a full rewrite — you decide how much changes, sentence by sentence.',
  },
  {
    icon: '🎯',
    title: 'Tone & domain presets',
    description: 'Balanced, formal, casual, academic, or professional tone, matched to general, academic, business, technical, medical, or legal writing.',
  },
  {
    icon: '🔒',
    title: 'Fact-locking',
    description: 'Numbers, dates, and citations are detected automatically and preserved verbatim through every rewrite — style changes, facts don’t.',
  },
  {
    icon: '✅',
    title: 'Built-in quality gates',
    description: 'Every rewrite is checked for fact preservation and meaning drift, with automatic retries if the output strays from your source.',
  },
  {
    icon: '🔍',
    title: 'AI-detection scan',
    description: 'Run a separate scan to see how your text classifies — human-written, AI-generated, or mixed — with a confidence score and signal breakdown.',
  },
  {
    icon: '💾',
    title: 'Saved presets',
    description: 'Save your favorite intensity, tone, and domain combination once, then apply it in a click on every document after.',
  },
  {
    icon: '🔌',
    title: 'Bring your own model',
    description: 'Plug in any OpenAI-compatible endpoint — OpenAI, DeepSeek, or a self-hosted model — with your own API key, synced across your devices.',
  },
  {
    icon: '📄',
    title: 'Export anywhere',
    description: 'Download your finished text as plain text, Markdown, or a formatted Word document, ready to hand in or publish.',
  },
]

export default function ProductPage() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-white">
      <PageBackground />

      <div className="relative z-10 flex min-h-screen flex-col">
        <SiteNav />

        <div className="flex-1 px-6 pb-20 pt-6 md:px-14">
          {/* Hero */}
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-gray-500">
              The product
            </p>
            <h1 className="mt-4 font-display text-4xl font-bold text-gray-900 md:text-6xl">
              Everything you need, one tool
            </h1>
            <p className="mx-auto mt-4 max-w-lg text-base leading-relaxed text-gray-600 md:text-lg">
              From a first AI-assisted draft to text you’d actually put your name on —
              humanize, scan, and export without leaving the page.
            </p>
            <Link
              href="/dashboard"
              className="mt-8 inline-flex items-center gap-2.5 rounded-full bg-gradient-to-r from-orange-500 to-red-500
                         px-8 py-4 text-base font-bold text-white shadow-lg shadow-orange-500/25
                         transition-transform hover:scale-[1.02] active:scale-[0.98]"
            >
              Try it free
              <ArrowIcon />
            </Link>
          </div>

          {/* Feature grid */}
          <div className="mx-auto mt-16 grid max-w-5xl gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(f => (
              <div key={f.title} className="rounded-2xl border border-white/60 bg-white/85 p-6 shadow-sm backdrop-blur-md">
                <span className="text-2xl" aria-hidden>{f.icon}</span>
                <h3 className="mt-3 text-sm font-semibold text-gray-900">{f.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-gray-600">{f.description}</p>
              </div>
            ))}
          </div>

          {/* How it works */}
          <div className="mx-auto mt-20 max-w-3xl text-center">
            <h2 className="font-display text-2xl font-bold text-gray-900 md:text-3xl">How it works</h2>
            <div className="mt-8 grid gap-6 text-left sm:grid-cols-3">
              {[
                { step: '1', title: 'Paste your text', desc: 'Drop in an AI-assisted draft, up to your plan’s limit.' },
                { step: '2', title: 'Set tone & intensity', desc: 'Pick a preset or dial in exactly how much should change.' },
                { step: '3', title: 'Review & export', desc: 'Check the quality-gate results, then export or copy your result.' },
              ].map(s => (
                <div key={s.step} className="rounded-2xl border border-white/60 bg-white/85 p-5 shadow-sm backdrop-blur-md">
                  <span className="font-display text-2xl font-bold text-orange-500">{s.step}</span>
                  <h3 className="mt-2 text-sm font-semibold text-gray-900">{s.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-gray-600">{s.desc}</p>
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

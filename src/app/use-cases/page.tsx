import Link from 'next/link'
import { SiteNav } from '@/components/marketing/SiteNav'
import { SiteFooter } from '@/components/marketing/SiteFooter'
import { PageBackground } from '@/components/marketing/PageBackground'
import { ArrowIcon, CheckIcon } from '@/components/marketing/icons'

const SEGMENTS = [
  {
    icon: '🎓',
    title: 'Students',
    tagline: 'Write essays and assignments that still sound like you.',
    points: [
      'Academic tone preset keeps citations and terminology exact',
      'Fact-locking preserves quoted sources and dates',
      'Scan mode shows how your draft is likely to be classified before you submit it',
    ],
  },
  {
    icon: '✍️',
    title: 'Writers & creators',
    tagline: 'Turn AI-assisted drafts into content that connects.',
    points: [
      'Adjustable intensity for a light polish or a full rewrite',
      'Casual and professional tone presets for blog posts, scripts, or newsletters',
      'Export straight to Markdown for your CMS',
    ],
  },
  {
    icon: '💼',
    title: 'Professionals',
    tagline: 'Communicate with clarity in emails, reports, and proposals.',
    points: [
      'Business and technical domain presets',
      'Quality gates catch dropped facts and meaning drift before you hit send',
      'Export to Word for documents that need to look the part',
    ],
  },
  {
    icon: '🏢',
    title: 'Teams & businesses',
    tagline: 'Keep a consistent voice across everyone who touches your content.',
    points: [
      'Saved presets standardize tone and intensity across a team',
      'Bring your own model for content that never leaves your chosen provider',
      'Long-document support for full reports and documentation',
    ],
  },
]

export default function UseCasesPage() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-white">
      <PageBackground />

      <div className="relative z-10 flex min-h-screen flex-col">
        <SiteNav />

        <div className="flex-1 px-6 pb-20 pt-6 md:px-14">
          {/* Hero */}
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-gray-500">
              Use cases
            </p>
            <h1 className="mt-4 font-display text-4xl font-bold text-gray-900 md:text-6xl">
              Built for the way you write
            </h1>
            <p className="mx-auto mt-4 max-w-lg text-base leading-relaxed text-gray-600 md:text-lg">
              Whatever you’re writing, Humanite adapts to it — not the other way around.
            </p>
          </div>

          {/* Segments */}
          <div className="mx-auto mt-14 grid max-w-5xl gap-6 md:grid-cols-2">
            {SEGMENTS.map(s => (
              <div key={s.title} className="rounded-2xl border border-white/60 bg-white/85 p-7 shadow-sm backdrop-blur-md">
                <span className="text-3xl" aria-hidden>{s.icon}</span>
                <h2 className="mt-3 text-lg font-semibold text-gray-900">{s.title}</h2>
                <p className="mt-1 text-sm text-gray-600">{s.tagline}</p>
                <ul className="mt-4 space-y-2.5">
                  {s.points.map(p => (
                    <li key={p} className="flex items-start gap-2.5 text-sm text-gray-600">
                      <CheckIcon className="mt-0.5 shrink-0 text-green-600" />
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {/* CTA */}
          <div className="mx-auto mt-16 max-w-xl text-center">
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2.5 rounded-full bg-gradient-to-r from-orange-500 to-red-500
                         px-8 py-4 text-base font-bold text-white shadow-lg shadow-orange-500/25
                         transition-transform hover:scale-[1.02] active:scale-[0.98]"
            >
              Try it with your own text
              <ArrowIcon />
            </Link>
          </div>
        </div>

        <SiteFooter />
      </div>
    </main>
  )
}

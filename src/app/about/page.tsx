import Link from 'next/link'
import { SiteNav } from '@/components/marketing/SiteNav'
import { SiteFooter } from '@/components/marketing/SiteFooter'
import { PageBackground } from '@/components/marketing/PageBackground'
import { ArrowIcon } from '@/components/marketing/icons'

export default function AboutPage() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-white">
      <PageBackground />

      <div className="relative z-10 flex min-h-screen flex-col">
        <SiteNav />

        <div className="flex-1 px-6 pb-20 pt-6 md:px-14">
          {/* Hero */}
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-gray-500">
              About
            </p>
            <h1 className="mt-4 font-display text-4xl font-bold text-gray-900 md:text-6xl">
              More human ideas
            </h1>
          </div>

          {/* Mission */}
          <div className="mx-auto mt-10 max-w-2xl rounded-2xl border border-white/60 bg-white/85 p-8 shadow-sm backdrop-blur-md">
            <p className="text-base leading-relaxed text-gray-700">
              AI writing tools help people think faster and write more — but left unedited,
              they tend to flatten everyone’s voice into the same predictable patterns:
              the same transition words, the same sentence rhythm, the same handful of
              vocabulary tics. Humanite exists to close that gap. It takes an AI-assisted
              draft and rewrites it to read the way you’d actually write it — same ideas,
              same facts, a voice that sounds like a person again.
            </p>
          </div>

          {/* How it works, briefly */}
          <div className="mx-auto mt-10 max-w-2xl rounded-2xl border border-white/60 bg-white/85 p-8 shadow-sm backdrop-blur-md">
            <h2 className="text-lg font-semibold text-gray-900">How we approach it</h2>
            <p className="mt-3 text-sm leading-relaxed text-gray-600">
              Every rewrite goes through automated quality gates that check for dropped
              facts and meaning drift before you ever see the output — style should
              change, content shouldn’t. Numbers, dates, and citations are detected and
              locked in place automatically. And if you’d rather use your own AI provider
              instead of ours, you can plug in your own API key at any time.
            </p>
          </div>

          {/* Contact */}
          <div className="mx-auto mt-10 max-w-2xl rounded-2xl border border-white/60 bg-white/85 p-8 text-center shadow-sm backdrop-blur-md">
            <h2 className="text-lg font-semibold text-gray-900">Get in touch</h2>
            <p className="mt-2 text-sm text-gray-600">
              Questions, feedback, or interested in Enterprise?{' '}
              <a href="mailto:hello@humanite.app" className="font-medium text-gray-900 underline underline-offset-2">
                hello@humanite.app
              </a>
            </p>
          </div>

          {/* CTA */}
          <div className="mx-auto mt-14 max-w-xl text-center">
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2.5 rounded-full bg-gradient-to-r from-orange-500 to-red-500
                         px-8 py-4 text-base font-bold text-white shadow-lg shadow-orange-500/25
                         transition-transform hover:scale-[1.02] active:scale-[0.98]"
            >
              Begin Transformation
              <ArrowIcon />
            </Link>
          </div>
        </div>

        <SiteFooter />
      </div>
    </main>
  )
}

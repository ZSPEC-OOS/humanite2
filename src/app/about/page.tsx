import Link from 'next/link'
import { SiteNav } from '@/components/marketing/SiteNav'
import { SiteFooter } from '@/components/marketing/SiteFooter'
import { ArrowIcon } from '@/components/marketing/icons'

export default function AboutPage() {
  return (
    <main className="min-h-screen bg-white dark:bg-gray-950">
      <div className="flex min-h-screen flex-col">
        <SiteNav />

        <div className="flex-1 px-6 pb-20 pt-6 md:px-14">
          {/* Hero */}
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-gray-500 dark:text-gray-400">
              About
            </p>
            <h1 className="mt-4 font-display text-4xl font-bold text-gray-900 dark:text-gray-100 md:text-6xl">
              More human ideas
            </h1>
          </div>

          {/* Mission */}
          <div className="mx-auto mt-10 max-w-2xl rounded-2xl border border-gray-200 bg-white p-8 dark:border-gray-800 dark:bg-gray-900">
            <div className="space-y-4 text-base leading-relaxed text-gray-700 dark:text-gray-300">
              <p>
                Artificial intelligence has taken hold of the cultural imagination, drawing
                fascination and suspicion in equal measure. Text produced by AI is often read as
                something lesser by nature: language untouched by lived experience, a shortcut
                that threatens to dull creativity, weaken independent thought, and displace the
                intellectual struggle through which a person develops an authentic voice.
              </p>
              <p>
                That worry points to something real. Writing has never been only the production
                of grammatically correct sentences. It carries judgment, memory, temperament,
                imagination, doubt, and intention. The great works of classical writing last not
                because they are perfectly optimized, but because their words seem inhabited by a
                mind. Their rhythm shifts. Their thoughts hesitate, accelerate, contradict,
                resolve. Behind the language, one senses a person.
              </p>
              <p>
                The future of artificial intelligence, then, should not be framed as a choice
                between human thought and machine assistance. The more pressing question is how
                AI can be woven into human expression without eroding the learning, reflection,
                and creativity that give writing its meaning.
              </p>
              <p>
                Used passively, artificial intelligence can foster intellectual dependence and
                yield language that is technically competent yet emotionally empty. Used
                deliberately, it can become an instrument of intellectual expansion: helping
                people develop ideas, test alternative forms of expression, sharpen difficult
                arguments, and communicate thoughts that might otherwise remain unfinished.
              </p>
              <p>This is what Humanite is for.</p>
              <p>
                Humanite rests on the principle that artificial intelligence should enhance human
                expression rather than standardize it. Its function is not merely to alter
                AI-generated sentences or hide their technological origin. It is to restore
                qualities that automated language often compresses: individual cadence,
                stylistic variation, emotional proportion, rhetorical intention, ambiguity,
                restraint, and personal voice.
              </p>
              <p>
                In classical writing, humanity tends to reside in precisely those qualities that
                optimization removes. A sentence may run unusually long because the thought
                demands patience. Another may end abruptly because certainty does not. A writer
                may repeat an idea not through inefficiency, but through emphasis. Language
                acquires character through such decisions.
              </p>
              <p>Humanite seeks to preserve that character.</p>
              <p>
                The aim is not to make machines imitate human beings more convincingly. It is to
                ensure that people who use intelligent systems do not lose the expressive
                qualities that make their writing recognizably their own. AI should work as an
                extension of human capability—not as a substitute for thought, experience, or
                authorship.
              </p>
              <p>
                The future of writing will likely involve increasingly powerful computational
                tools. The central challenge, then, will not be whether humanity can stop
                machines from producing language. It will be whether human beings can continue to
                recognize themselves in the language those tools help them create.
              </p>
              <p>Humanite exists to keep the human presence in the sentence.</p>
            </div>
          </div>

          {/* AI detection */}
          <div className="mx-auto mt-10 max-w-2xl rounded-2xl border border-gray-200 bg-white p-8 dark:border-gray-800 dark:bg-gray-900">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Independent AI detection</h2>
            <p className="mt-3 text-sm leading-relaxed text-gray-600 dark:text-gray-400">
              Every scan runs through Sapling, a dedicated AI-detection model — not the language
              model that helped write the draft. Detection never receives your generation settings,
              API key, or model choice, so it can’t grade text more favorably just because it
              recognizes how it was produced. Results come back sentence by sentence, so you can see
              exactly which passages are driving the score instead of a single number for the whole
              document.
            </p>
          </div>

          {/* How it works, briefly */}
          <div className="mx-auto mt-10 max-w-2xl rounded-2xl border border-gray-200 bg-white p-8 dark:border-gray-800 dark:bg-gray-900">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">How we approach it</h2>
            <p className="mt-3 text-sm leading-relaxed text-gray-600 dark:text-gray-400">
              Every rewrite goes through automated quality gates that check for dropped
              facts and meaning drift before you ever see the output — style should
              change, content shouldn’t. Numbers, dates, and citations are detected and
              locked in place automatically. And if you’d rather use your own AI provider
              instead of ours, you can plug in your own API key at any time.
            </p>
          </div>

          {/* Contact */}
          <div className="mx-auto mt-10 max-w-2xl rounded-2xl border border-gray-200 bg-white p-8 text-center dark:border-gray-800 dark:bg-gray-900">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Get in touch</h2>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
              Questions, feedback, or interested in Enterprise?{' '}
              <a href="mailto:hello@humanite.app" className="font-medium text-gray-900 underline underline-offset-2 dark:text-gray-100">
                hello@humanite.app
              </a>
            </p>
          </div>

          {/* CTA */}
          <div className="mx-auto mt-14 max-w-xl text-center">
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2.5 rounded-full bg-gray-900
                         px-8 py-4 text-base font-bold text-white
                         transition-colors hover:bg-gray-800
                         dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white"
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

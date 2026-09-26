import type { Tone, ToneProfile } from './types'

// Examples arrays are intentionally empty — "1-2 short human-written
// examples from the Phase 2 reference set" per the plan, and that set
// (tests/benchmark/reference/) is itself unpopulated for the reasons
// documented there (an AI authoring "human-written" examples would
// silently invalidate them). A human curator should add 1-2 short excerpts
// per profile here, attributed via `source`, once real reference passages
// exist to draw them from.
export const TONE_PROFILES: Record<Tone, ToneProfile> = {
  balanced: {
    tone: 'balanced',
    description: 'A neutral, general-audience register — neither markedly casual nor markedly formal.',
    rules: [
      { tag: 'contractions', text: 'Use contractions where they read naturally (e.g. "it\'s", "don\'t"), but do not force them into every sentence.' },
      { tag: 'sentence-length', text: 'Vary sentence length moderately; avoid runs of uniformly long or uniformly short sentences.' },
      { tag: 'person', text: 'Use whichever grammatical person the source already uses; do not introduce a first-person voice that was not there.' },
      { tag: 'hedging', text: 'Hedge claims only where the source itself is uncertain — do not add or remove epistemic caution.' },
      { tag: 'vocabulary', text: 'Prefer everyday words over specialized jargon unless the jargon is the clearest way to say it.' },
    ],
    examples: [],
  },
  formal: {
    tone: 'formal',
    description: 'A measured, professional register with no casual affect.',
    rules: [
      { tag: 'contractions', text: 'Avoid contractions; write out "do not", "it is", "cannot" in full.' },
      { tag: 'sentence-length', text: 'Prefer complete, moderately complex sentences over sentence fragments.' },
      { tag: 'person', text: 'Avoid first-person voice ("I", "we") unless the source itself speaks in first person.' },
      { tag: 'hedging', text: 'Use measured, precise qualifiers ("appears to", "the data indicate") rather than blunt overstatement.' },
      { tag: 'vocabulary', text: 'Favor precise, formal vocabulary over colloquialisms and slang.' },
    ],
    examples: [],
  },
  casual: {
    tone: 'casual',
    description: 'A relaxed, conversational register, as if explaining the material to a friend.',
    rules: [
      { tag: 'contractions', text: 'Use contractions freely ("it\'s", "don\'t", "you\'re") — a version without them will read stiffly.' },
      { tag: 'sentence-length', text: 'Favor shorter, punchier sentences; break up long sentences into two where it reads better.' },
      { tag: 'person', text: 'Address the reader directly with "you" where it reads naturally, and use "I"/"we" if the source\'s own voice supports it.' },
      { tag: 'hedging', text: 'Keep hedging light — say things plainly rather than piling on qualifiers.' },
      { tag: 'vocabulary', text: 'Prefer everyday, conversational words over formal or technical vocabulary wherever meaning allows.' },
    ],
    examples: [],
  },
  academic: {
    tone: 'academic',
    description: 'A scholarly register: careful, hedged, and impersonal.',
    rules: [
      { tag: 'contractions', text: 'Avoid contractions entirely.' },
      { tag: 'sentence-length', text: 'Longer, subordinated sentences are acceptable where they accurately convey a qualified claim; avoid choppy fragments.' },
      { tag: 'person', text: 'Prefer third-person, impersonal constructions ("the results suggest") over first-person voice.' },
      { tag: 'hedging', text: 'Hedge claims explicitly with epistemic markers ("may", "suggests", "appears to") rather than stating them as flat fact, unless the source itself states them as flat fact.' },
      { tag: 'vocabulary', text: 'Precise, discipline-appropriate terminology is preferred over simplified paraphrase.' },
    ],
    examples: [],
  },
  professional: {
    tone: 'professional',
    description: 'A clear, businesslike register — polished but not academic.',
    rules: [
      { tag: 'contractions', text: 'Light, occasional contractions are acceptable; avoid using them in every sentence.' },
      { tag: 'sentence-length', text: 'Prefer clear, moderate-length sentences; avoid both academic-style long subordination and casual sentence fragments.' },
      { tag: 'person', text: 'First-person plural ("we") is acceptable in a business context; avoid singular first-person unless the source uses it.' },
      { tag: 'hedging', text: 'Hedge only where genuinely uncertain — a business audience expects confident, direct statements otherwise.' },
      { tag: 'vocabulary', text: 'Prefer plain, business-appropriate vocabulary over academic jargon or slang.' },
    ],
    examples: [],
  },
}

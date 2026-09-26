import type { Audience, AudienceProfile } from './types'

// The 7 audiences the plan names. `overrides` here can only ever list tags
// that outrank TONE — audience sits below domain and genre in the plan's
// precedence chain ("domain > genre > audience > tone"), never above them,
// so an audience rule never overrides a domain or genre rule sharing its
// tag (see compiler.ts).
export const AUDIENCE_PROFILES: Record<Audience, AudienceProfile> = {
  general: {
    audience: 'general',
    description: 'A general reader with no assumed specialized background.',
    rules: [
      { tag: 'vocabulary', text: 'Assume no specialized background knowledge; prefer plain-language explanations over unexplained jargon.' },
    ],
    examples: [],
    overrides: [],
  },
  expert: {
    audience: 'expert',
    description: 'A subject-matter expert who already knows the field\'s own vocabulary.',
    rules: [
      { tag: 'vocabulary', text: 'Technical shorthand and field-specific jargon are appropriate; do not over-explain or simplify terms an expert reader already knows, regardless of the selected tone.' },
    ],
    examples: [],
    overrides: ['vocabulary'],
  },
  executive: {
    audience: 'executive',
    description: 'A time-constrained executive reader who wants the conclusion first.',
    rules: [
      { tag: 'structure', text: 'Lead with the conclusion or recommendation before supporting detail — an executive reader wants the bottom line first.' },
      { tag: 'sentence-length', text: 'Favor brevity; trim supporting detail an executive audience does not need in order to act, regardless of the selected tone.' },
    ],
    examples: [],
    overrides: ['sentence-length'],
  },
  academic: {
    audience: 'academic',
    description: 'An academic reader who expects precise, discipline-appropriate terminology.',
    rules: [
      { tag: 'vocabulary', text: 'Precise, discipline-appropriate terminology is expected and should not be simplified away.' },
    ],
    examples: [],
    overrides: [],
  },
  customer: {
    audience: 'customer',
    description: 'An external customer with no visibility into internal systems or process.',
    rules: [
      { tag: 'vocabulary', text: 'Avoid internal or organizational jargon (system names, internal process terms) a customer would not recognize; use customer-facing language instead.' },
      { tag: 'person', text: 'Address the reader directly as "you" where it reads naturally.' },
    ],
    examples: [],
    overrides: [],
  },
  patient: {
    audience: 'patient',
    description: 'A patient without medical training, reading about their own care.',
    rules: [
      { tag: 'vocabulary', text: 'Replace clinical or technical jargon with plain-language equivalents a patient without medical training would understand, regardless of the selected tone.' },
      { tag: 'sentence-length', text: 'Use short, clear sentences, regardless of the selected tone.' },
    ],
    examples: [],
    overrides: ['vocabulary', 'sentence-length'],
  },
  regulatory: {
    audience: 'regulatory',
    description: 'A regulatory or compliance reader who needs exact, unambiguous obligation language.',
    rules: [
      { tag: 'hedging', text: 'Preserve precise regulatory/compliance qualifiers exactly ("shall", "must", "is required to") — never soften or strengthen a compliance obligation, regardless of the selected tone.' },
      { tag: 'contractions', text: 'Never use contractions, regardless of the selected tone.' },
    ],
    examples: [],
    overrides: ['contractions', 'hedging'],
  },
}

import type { Genre, GenreProfile } from './types'

// The 11 genres the plan names. Each genre's `overrides` lists only the
// tags where its own convention is a genuine, hard expectation of the
// format — not every rule below overrides tone, the same restraint
// domainProfiles.ts already applies (most rules simply add to what tone
// already says; only a real convention silently drops a conflicting tone
// preference). Examples arrays are empty for the same reason as
// toneProfiles.ts/domainProfiles.ts — see the note there.
export const GENRE_PROFILES: Record<Genre, GenreProfile> = {
  essay: {
    genre: 'essay',
    description: 'An argumentative or reflective essay — a thesis supported by developed points.',
    rules: [
      { tag: 'person', text: 'A first-person voice ("I argue", "I contend") is appropriate if the source already uses one; do not suppress it into third person.' },
      { tag: 'structure', text: "Keep each supporting point attached to the specific claim or thesis it supports; never let a rewrite detach evidence from what it's evidence for." },
    ],
    examples: [],
    overrides: [],
  },
  research_paper: {
    genre: 'research_paper',
    description: 'A research paper or manuscript — methodology, results, and calibrated findings.',
    rules: [
      { tag: 'person', text: 'Prefer third-person, impersonal constructions ("the results indicate") over first-person voice — standard research-paper convention, regardless of the selected tone.' },
      { tag: 'structure', text: 'Preserve methodology, results, and conclusion sections in their original order; never reorder them.' },
      { tag: 'hedging', text: 'Preserve calibrated hedging around findings exactly ("may indicate", "is consistent with") — never overstate a qualified finding as settled fact, regardless of the selected tone.' },
    ],
    examples: [],
    overrides: ['person', 'hedging'],
  },
  report: {
    genre: 'report',
    description: 'A structured business or analytical report, organized under headings.',
    rules: [
      { tag: 'structure', text: 'Preserve section and subsection structure; keep each finding under its own heading rather than merging sections together.' },
      { tag: 'person', text: 'Prefer third-person or organizational voice ("the analysis found") over first-person — standard report convention, regardless of the selected tone.' },
    ],
    examples: [],
    overrides: ['person'],
  },
  email: {
    genre: 'email',
    description: 'An email — a greeting and sign-off framing a concise body.',
    rules: [
      { tag: 'structure', text: 'Preserve any greeting and sign-off exactly as their own lines; never fold them into a body paragraph.' },
      { tag: 'sentence-length', text: 'Keep paragraphs short (2-4 sentences) — standard email convention, regardless of the selected tone.' },
    ],
    examples: [],
    overrides: ['sentence-length'],
  },
  proposal: {
    genre: 'proposal',
    description: 'A persuasive proposal — benefits and deliverables framed against a need.',
    rules: [
      { tag: 'structure', text: 'Keep each proposed benefit or deliverable attached to the specific need or problem it addresses.' },
      { tag: 'vocabulary', text: 'Favor concrete, benefit-oriented language over abstract description.' },
    ],
    examples: [],
    overrides: [],
  },
  blog: {
    genre: 'blog',
    description: 'A blog post — conversational, reader-facing writing.',
    rules: [
      { tag: 'person', text: 'First- and second-person voice ("I", "you") is appropriate if the source uses it.' },
      { tag: 'contractions', text: "Contractions fit this format's conversational register." },
    ],
    examples: [],
    overrides: [],
  },
  documentation: {
    genre: 'documentation',
    description: 'Technical documentation — step-by-step instructions or reference material.',
    rules: [
      { tag: 'structure', text: 'Never reorder numbered steps or procedures — the Nth step in the rewrite must be the same step as the Nth step in the source.' },
      { tag: 'person', text: 'Prefer imperative mood ("click Save") over descriptive mood ("the user clicks Save") for instructions — standard documentation convention, regardless of the selected tone.' },
      { tag: 'vocabulary', text: 'Never rephrase a UI label, command, file path, or code token — reproduce it character-for-character, regardless of the selected tone.' },
    ],
    examples: [],
    overrides: ['person', 'vocabulary'],
  },
  clinical_note: {
    genre: 'clinical_note',
    description: 'A clinical note — terse, abbreviation-heavy clinician-to-clinician shorthand.',
    rules: [
      { tag: 'sentence-length', text: 'Terse, fragment-style sentences are appropriate and expected — do not expand clinical shorthand into full prose, regardless of the selected tone.' },
      { tag: 'vocabulary', text: 'Preserve standard clinical abbreviations exactly as written; do not spell them out, regardless of the selected tone.' },
    ],
    examples: [],
    overrides: ['sentence-length', 'vocabulary'],
  },
  patient_instructions: {
    genre: 'patient_instructions',
    description: 'Patient-facing instructions — plain-language, actionable guidance.',
    rules: [
      { tag: 'vocabulary', text: 'Replace clinical jargon with plain-language equivalents wherever the meaning survives exactly (e.g. "high blood pressure" rather than "hypertension"), regardless of the selected tone.' },
      { tag: 'sentence-length', text: 'Use short, simple sentences — one instruction per sentence, regardless of the selected tone.' },
      { tag: 'person', text: 'Address the reader directly as "you"; use imperative mood for instructions ("take this medicine with food").' },
    ],
    examples: [],
    overrides: ['vocabulary', 'sentence-length', 'person'],
  },
  contract: {
    genre: 'contract',
    description: 'A contract or agreement — numbered clauses and defined terms.',
    rules: [
      { tag: 'structure', text: 'Preserve numbered clause structure and every defined term exactly; never paraphrase a defined term.' },
      { tag: 'contractions', text: 'Never use contractions, regardless of the selected tone.' },
    ],
    examples: [],
    overrides: ['contractions'],
  },
  memo: {
    genre: 'memo',
    description: 'An internal memo — brief, direct, with a header block.',
    rules: [
      { tag: 'structure', text: 'Preserve any header block (To/From/Date/Re) exactly as its own lines.' },
      { tag: 'sentence-length', text: 'Favor short, direct sentences; state the point in the first sentence of each paragraph, regardless of the selected tone.' },
    ],
    examples: [],
    overrides: ['sentence-length'],
  },
}

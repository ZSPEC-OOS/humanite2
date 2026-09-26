import type { Domain, DomainProfile } from './types'

// Examples arrays are intentionally empty — see the same note in
// toneProfiles.ts.
export const DOMAIN_PROFILES: Record<Domain, DomainProfile> = {
  general: {
    domain: 'general',
    description: 'No domain-specific constraints beyond the selected tone.',
    rules: [],
    examples: [],
    overrides: [],
  },
  academic: {
    domain: 'academic',
    description: 'Scholarly-writing constraints: hedge strength and citation attachment. Independent of the "academic" tone — a user can select tone=casual with domain=academic (a plain-language summary of a paper), or tone=academic with domain=business, and both axes still apply.',
    rules: [
      { tag: 'hedging', text: 'Preserve the exact strength of every hedge in the source — "may" must not become "will"; "suggests" must not become "proves" — regardless of the selected tone.' },
      { tag: 'structure', text: 'Keep every citation (e.g. "(Smith, 2020)", "[12]") immediately attached to the specific claim it supports; never let a rewrite separate a citation from its claim or move it to a different sentence.' },
    ],
    examples: [],
    overrides: ['hedging'],
  },
  business: {
    domain: 'business',
    description: 'Light business-writing constraints; otherwise defers entirely to the selected tone.',
    rules: [
      { tag: 'structure', text: 'Keep every quantitative claim (a figure, percentage, or date) attached to the same qualifier and direction it had in the source — an increase must stay an increase, a decline must stay a decline.' },
    ],
    examples: [],
    overrides: [],
  },
  technical: {
    domain: 'technical',
    description: 'Preserve identifiers and procedural order exactly, regardless of tone.',
    rules: [
      { tag: 'vocabulary', text: 'Never rephrase an identifier: a version number, command, file path, API endpoint, or code token must appear character-for-character as in the source.' },
      { tag: 'structure', text: 'Never reorder steps in a numbered or sequential procedure — the Nth step in the rewrite must be the same step as the Nth step in the source.' },
    ],
    examples: [],
    overrides: ['vocabulary'],
  },
  medical: {
    domain: 'medical',
    description: 'Preserve negation, dose-frequency relations, and calibrated clinical uncertainty exactly, regardless of tone.',
    rules: [
      { tag: 'structure', text: 'Never drop, add, or move a negation ("not", "no", "without") — a negated claim must stay negated.' },
      { tag: 'structure', text: 'Keep every dose tied to its exact frequency and route (e.g. "5 mg once daily") — never separate a dose from the frequency it was originally paired with.' },
      { tag: 'hedging', text: 'Preserve the exact strength of clinical uncertainty language in the source — "may cause" must not become "causes"; "is not recommended" must not become "is recommended" — regardless of the selected tone.' },
    ],
    examples: [],
    overrides: ['hedging'],
  },
  legal: {
    domain: 'legal',
    description: 'Preserve defined terms, modality, and conditional structure; never use contractions, regardless of tone.',
    rules: [
      { tag: 'contractions', text: 'Never use contractions, regardless of the selected tone — contractions are never appropriate in contract or statutory language.' },
      { tag: 'structure', text: 'Preserve every defined term and capitalized cross-reference ("the Agreement", "Section 4", "Schedule 3.4") exactly as written; never paraphrase a defined term.' },
      { tag: 'structure', text: 'Preserve modal verbs exactly: "shall" must not become "will" or "may"; "may" must not become "shall" or "must".' },
      { tag: 'structure', text: 'Preserve every condition and exception clause ("unless", "except", "provided that") and what it attaches to — never drop or relocate one.' },
    ],
    examples: [],
    overrides: ['contractions'],
  },
}

import type { FidelityFact } from '../types'

// Plain (non-LaTeX) scientific notation: "3.2 x 10^-4" or "3.2e-4" — not
// covered by preprocess.ts's EQUATION_RE (LaTeX-delimited only), and its
// NUMBER_RE tokenizes the exponent into a bare digit, silently surviving
// an exponent-sign flip that changes the value by many orders of
// magnitude. Captures the FULL span, sign included, as one fact.
const SCIENTIFIC_NOTATION_RE = /\b\d+(?:\.\d+)?\s*[x×]\s*10\^[+-]?\d+\b|\b\d+(?:\.\d+)?[eE][+-]?\d+\b/g

export function extractScientificNotation(sentence: string, sentenceIndex: number): FidelityFact[] {
  const facts: FidelityFact[] = []
  for (const m of sentence.matchAll(SCIENTIFIC_NOTATION_RE)) {
    facts.push({
      type: 'scientific_notation',
      sentenceIndex,
      text: m[0],
      data: { text: m[0].replace(/\s+/g, ' ').toLowerCase() },
    })
  }
  return facts
}

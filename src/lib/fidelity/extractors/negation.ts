import type { FidelityFact } from '../types'

// "negation (not, no, never, denies, without, double negation)" per the
// plan's Phase 5 extractor list, plus the common contracted forms —
// each occurrence is its own fact, so a sentence with two negation markers
// (a double negation) produces two facts, and dropping either one is
// caught independently.
const NEGATION_WORDS = [
  'not', 'no', 'never', 'denies', 'deny', 'denied', 'without', 'cannot',
  "can't", "isn't", "aren't", "doesn't", "don't", "didn't",
  "wasn't", "weren't", "won't", "wouldn't", "shouldn't", "couldn't",
]
const NEGATION_RE = new RegExp(`\\b(${NEGATION_WORDS.join('|')})\\b`, 'gi')

// One fact per SENTENCE (a count), not one per exact word — "did not
// increase" rephrased as "was not observed to increase" still uses "not",
// but "showed no increase" is an equally valid negation using a different
// word entirely. Comparing the count catches a genuinely DROPPED negation
// (1 -> 0) and a reduced double negation (2 -> 1) without falsely failing
// a correct rewrite that swaps which negation word it uses.
export function extractNegation(sentence: string, sentenceIndex: number): FidelityFact[] {
  const matches = [...sentence.matchAll(NEGATION_RE)]
  if (matches.length === 0) return []
  return [{
    type: 'negation',
    sentenceIndex,
    text: matches.map(m => m[0]).join(', '),
    data: { count: matches.length },
  }]
}

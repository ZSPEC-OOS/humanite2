import { EQUATION_RE } from '@/lib/preprocess'
import type { FidelityFact } from '../types'

// Reuses preprocess.ts's existing (LaTeX-delimited) equation regex, with
// sentence-local binding on top — see citations.ts for why.
export function extractEquations(sentence: string, sentenceIndex: number): FidelityFact[] {
  const facts: FidelityFact[] = []
  for (const m of sentence.matchAll(EQUATION_RE)) {
    facts.push({ type: 'equation', sentenceIndex, text: m[0], data: { text: m[0].replace(/\s+/g, ' ') } })
  }
  return facts
}

import { CHEMICAL_RE } from '@/lib/preprocess'
import type { FidelityFact } from '../types'

// Reuses preprocess.ts's existing chemical-formula regex, with
// sentence-local binding on top — see citations.ts for why.
export function extractChemicals(sentence: string, sentenceIndex: number): FidelityFact[] {
  const facts: FidelityFact[] = []
  for (const m of sentence.matchAll(CHEMICAL_RE)) {
    facts.push({ type: 'chemical', sentenceIndex, text: m[0], data: { text: m[0] } })
  }
  return facts
}

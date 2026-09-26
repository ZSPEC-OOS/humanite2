import { DATE_RE } from '@/lib/preprocess'
import type { FidelityFact } from '../types'

// Reuses preprocess.ts's existing date regex, with sentence-local binding
// on top — see citations.ts for why.
export function extractDates(sentence: string, sentenceIndex: number): FidelityFact[] {
  const facts: FidelityFact[] = []
  for (const m of sentence.matchAll(DATE_RE)) {
    facts.push({ type: 'date', sentenceIndex, text: m[0], data: { text: m[0].toLowerCase() } })
  }
  return facts
}

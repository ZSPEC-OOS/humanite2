import { CITATION_RE } from '@/lib/preprocess'
import type { FidelityFact } from '../types'

// Reuses preprocess.ts's existing citation regex ("keeping the existing
// regex locks" per the plan) rather than duplicating it, layering
// sentence-local binding on top: two citations swapped between two claims
// in the same sentence is invisible to checkEntityOverlap's whole-document
// presence check, but not to a per-sentence one.
export function extractCitations(sentence: string, sentenceIndex: number): FidelityFact[] {
  const facts: FidelityFact[] = []
  for (const m of sentence.matchAll(CITATION_RE)) {
    facts.push({ type: 'citation', sentenceIndex, text: m[0], data: { text: m[0] } })
  }
  return facts
}

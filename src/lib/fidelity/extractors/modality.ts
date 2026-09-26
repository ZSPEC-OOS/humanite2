import type { FidelityFact } from '../types'

// "modality (must / shall / may / should / will)" per the plan's Phase 5
// extractor list, plus two common modals of the same kind.
const MODAL_WORDS = ['must', 'shall', 'may', 'should', 'will', 'might', 'could']
const MODAL_RE = new RegExp(`\\b(${MODAL_WORDS.join('|')})\\b`, 'gi')

export function extractModality(sentence: string, sentenceIndex: number): FidelityFact[] {
  const facts: FidelityFact[] = []
  for (const m of sentence.matchAll(MODAL_RE)) {
    facts.push({
      type: 'modality',
      sentenceIndex,
      text: m[0],
      data: { modal: m[0].toLowerCase() },
    })
  }
  return facts
}

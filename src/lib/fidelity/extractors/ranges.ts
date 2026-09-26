import type { FidelityFact } from '../types'

// "from A to B" / "between A and C" — captured as one ORDERED (low, high)
// fact rather than two independent numbers, so swapping the endpoints (a
// dosing min/max inversion) changes the fact even though both numbers
// individually still appear somewhere in the sentence.
const RANGE_RE = /\b(?:from|between)\s+([\d,.]+\s*[a-zA-Z%°]*)\s+(?:to|and)\s+([\d,.]+\s*[a-zA-Z%°]*)\b/gi

export function extractRanges(sentence: string, sentenceIndex: number): FidelityFact[] {
  const facts: FidelityFact[] = []
  for (const m of sentence.matchAll(RANGE_RE)) {
    facts.push({
      type: 'range',
      sentenceIndex,
      text: m[0],
      data: {
        low: m[1]!.trim().toLowerCase(),
        high: m[2]!.trim().toLowerCase(),
      },
    })
  }
  return facts
}

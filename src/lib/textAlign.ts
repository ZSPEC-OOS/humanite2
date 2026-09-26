import { tokenizeWords } from '@/lib/detection/diagnostics/tokenize'

// Shared sentence-alignment primitive — a lightweight stand-in for real
// sentence alignment that needs no NLP dependency. Used by both
// src/lib/evaluation/intensity.ts (to measure how much sentence order
// changed) and src/lib/fidelity/validator.ts (to find which output
// sentence a source fact should still hold true in).

export interface SentenceAlignment {
  sourceIndex: number
  outputIndex: number
  score: number
}

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1
  const setA = new Set(a)
  const setB = new Set(b)
  let intersection = 0
  for (const word of setA) if (setB.has(word)) intersection++
  const unionSize = new Set([...setA, ...setB]).size
  return unionSize === 0 ? 0 : intersection / unionSize
}

// A match below this floor is treated as "not the same sentence" (e.g. a
// genuinely new sentence the rewrite introduced) rather than forced onto
// whatever source sentence happens to be left over.
const MIN_ALIGNMENT_SIMILARITY = 0.2

// Greedily matches each output sentence to its most word-similar,
// not-yet-claimed source sentence, in output order. Each source sentence
// is claimed by at most one output sentence.
export function alignSentences(sourceSentences: string[], outputSentences: string[]): SentenceAlignment[] {
  const sourceWordSets = sourceSentences.map(s => tokenizeWords(s))
  const claimed = new Set<number>()
  const alignments: SentenceAlignment[] = []

  outputSentences.forEach((outputSentence, outputIndex) => {
    const outputWords = tokenizeWords(outputSentence)
    let bestIndex = -1
    let bestScore = 0
    for (let i = 0; i < sourceWordSets.length; i++) {
      if (claimed.has(i)) continue
      const score = jaccard(outputWords, sourceWordSets[i]!)
      if (score > bestScore) {
        bestScore = score
        bestIndex = i
      }
    }
    if (bestIndex !== -1 && bestScore >= MIN_ALIGNMENT_SIMILARITY) {
      claimed.add(bestIndex)
      alignments.push({ sourceIndex: bestIndex, outputIndex, score: bestScore })
    }
  })

  return alignments
}

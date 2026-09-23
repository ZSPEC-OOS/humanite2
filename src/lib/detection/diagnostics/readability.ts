import { splitSentences, tokenizeWords } from './tokenize'

// Standard Flesch Reading Ease formula. Syllable counting uses a common
// vowel-group heuristic rather than a dictionary lookup — approximate by
// design, consistent with this module's role as a descriptive diagnostic,
// never a scored input to any classification.
export function computeReadabilityScore(text: string): number | null {
  const sentences = splitSentences(text)
  const words = tokenizeWords(text)
  if (sentences.length === 0 || words.length === 0) return null

  const syllableCount = words.reduce((sum, w) => sum + countSyllables(w), 0)
  const score =
    206.835
    - 1.015 * (words.length / sentences.length)
    - 84.6 * (syllableCount / words.length)

  return Math.round(score * 100) / 100
}

function countSyllables(word: string): number {
  const cleaned = word.replace(/'/g, '')
  const vowelGroups = cleaned.match(/[aeiouy]+/g) ?? []
  let count = vowelGroups.length
  if (cleaned.endsWith('e') && count > 1) count -= 1
  return Math.max(count, 1)
}

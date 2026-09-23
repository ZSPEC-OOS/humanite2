import { tokenizeWords } from './tokenize'
import { rate, round } from './util'

export interface RepetitionStats {
  repeated_bigram_rate: number
  repeated_trigram_rate: number
}

function ngrams(words: string[], n: number): string[] {
  if (words.length < n) return []
  const grams: string[] = []
  for (let i = 0; i <= words.length - n; i++) {
    grams.push(words.slice(i, i + n).join(' '))
  }
  return grams
}

// Fraction of n-grams that repeat one seen earlier in the document —
// a phrase-repetition signal, not a plagiarism/overlap check.
function repeatedRate(grams: string[]): number {
  const seen = new Set<string>()
  let repeated = 0
  for (const gram of grams) {
    if (seen.has(gram)) repeated++
    else seen.add(gram)
  }
  return rate(repeated, grams.length)
}

export function computeRepetitionStats(text: string): RepetitionStats {
  const words = tokenizeWords(text)
  return {
    repeated_bigram_rate: round(repeatedRate(ngrams(words, 2))),
    repeated_trigram_rate: round(repeatedRate(ngrams(words, 3))),
  }
}

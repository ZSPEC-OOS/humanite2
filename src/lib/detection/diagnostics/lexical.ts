import { tokenizeWords } from './tokenize'
import { rate, round } from './util'

export interface LexicalStats {
  lexical_diversity: number
  contraction_rate: number
  first_person_rate: number
}

// "'s" is ambiguous between a contraction ("it's") and a possessive
// ("Sam's") without more context than a word-level heuristic has — counted
// as a contraction here, consistent with this module's role as a rough
// descriptive statistic rather than a precise linguistic parse.
const CONTRACTION_SUFFIX_RE = /'(t|re|ve|ll|d|s|m)$/

const FIRST_PERSON_WORDS = new Set([
  'i', 'me', 'my', 'mine', 'myself',
  'we', 'us', 'our', 'ours', 'ourselves',
])

export function computeLexicalStats(text: string): LexicalStats {
  const words = tokenizeWords(text)
  const uniqueWords = new Set(words)
  const contractionCount = words.filter(w => CONTRACTION_SUFFIX_RE.test(w)).length
  const firstPersonCount = words.filter(w => FIRST_PERSON_WORDS.has(w)).length

  return {
    lexical_diversity: round(rate(uniqueWords.size, words.length)),
    contraction_rate: round(rate(contractionCount, words.length)),
    first_person_rate: round(rate(firstPersonCount, words.length)),
  }
}

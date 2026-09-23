import { LocalDiagnostics } from '../contracts'
import { computeLexicalStats } from './lexical'
import { computeReadabilityScore } from './readability'
import { computeRepetitionStats } from './repetition'
import { computeStructuralStats } from './structural'

// Descriptive writing statistics only (spec §17/§18) — sentence/paragraph
// shape, vocabulary, repetition, readability. Never combined into an
// AI-probability of our own; GPTZero is the sole source of that judgment.
// Requires no detection-model infrastructure, so this runs synchronously.
export function calculateLocalDiagnostics(text: string): LocalDiagnostics {
  return {
    ...computeStructuralStats(text),
    ...computeLexicalStats(text),
    ...computeRepetitionStats(text),
    readability_score: computeReadabilityScore(text),
  }
}

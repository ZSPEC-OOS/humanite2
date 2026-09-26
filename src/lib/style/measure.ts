import { calculateLocalDiagnostics } from '@/lib/detection/diagnostics'
import { tokenizeWords } from '@/lib/detection/diagnostics/tokenize'
import { rate, round } from '@/lib/detection/diagnostics/util'
import type { LocalDiagnostics } from '@/lib/detection/contracts'

// Epistemic-caution markers a writer uses to soften a claim's certainty —
// the same category the Phase 2 benchmark corpus (academic.ts) codes as
// "epistemic hedges", and the metric Phase 3's own acceptance criterion
// names directly ("hedge density"). Not part of LocalDiagnostics itself:
// that module computes AI-detection-relevant descriptive stats (spec
// §17/§18) and is deliberately never extended with a style-specific metric
// that has nothing to do with detection.
const HEDGE_WORDS = new Set([
  'may', 'might', 'could', 'suggests', 'suggest', 'suggested', 'appears',
  'appear', 'seems', 'seem', 'likely', 'possibly', 'perhaps', 'somewhat',
  'relatively', 'arguably', 'presumably', 'tends', 'tend', 'generally',
  'often', 'typically', 'roughly', 'approximately', 'indicate', 'indicates',
  'indicated', 'potentially',
])

export interface StyleDiagnostics extends LocalDiagnostics {
  hedge_density: number
}

// The measurement side of Phase 3's acceptance criterion: "measured
// differences in contraction rate, sentence length, person and hedge
// density move in the specified direction." Reuses the existing
// contraction_rate/first_person_rate/average_sentence_length already
// computed for AI-detection diagnostics rather than re-implementing them,
// and adds the one metric that module has no reason to carry.
export function measureStyleDiagnostics(text: string): StyleDiagnostics {
  const words = tokenizeWords(text)
  const hedgeCount = words.filter(w => HEDGE_WORDS.has(w)).length
  return {
    ...calculateLocalDiagnostics(text),
    hedge_density: round(rate(hedgeCount, words.length)),
  }
}

import { splitSentences } from '@/lib/detection/diagnostics/tokenize'
import { extractQuantities } from './extractors/quantities'
import { extractRanges } from './extractors/ranges'
import { extractScientificNotation } from './extractors/scientificNotation'
import { extractModality } from './extractors/modality'
import { extractNegation } from './extractors/negation'
import { extractVersionNumbers } from './extractors/versionNumbers'
import { extractCrossReferences } from './extractors/crossReferences'
import { extractEntityPairs } from './extractors/entityPairs'
import { extractCitations } from './extractors/citations'
import { extractDates } from './extractors/dates'
import { extractEquations } from './extractors/equations'
import { extractChemicals } from './extractors/chemicals'
import type { FidelityExtractor, FidelityFact, FidelityFactType } from './types'

// One entry per fact type, reused by validator.ts to re-run the SAME
// extractor against a single aligned output sentence during validation.
export const EXTRACTOR_BY_TYPE: Record<FidelityFactType, FidelityExtractor> = {
  quantity: extractQuantities,
  range: extractRanges,
  scientific_notation: extractScientificNotation,
  modality: extractModality,
  negation: extractNegation,
  version: extractVersionNumbers,
  cross_reference: extractCrossReferences,
  entity_pair: extractEntityPairs,
  citation: extractCitations,
  date: extractDates,
  equation: extractEquations,
  chemical: extractChemicals,
}

const ALL_EXTRACTORS = Object.values(EXTRACTOR_BY_TYPE)

// Builds the full set of deterministic facts for a source text, one
// sentence at a time. Each fact remembers which source sentence it came
// from (sentenceIndex) — that's what validator.ts binds to the aligned
// output sentence rather than checking presence anywhere in the output.
export function buildFactLedger(text: string): FidelityFact[] {
  const sentences = splitSentences(text)
  const facts: FidelityFact[] = []
  sentences.forEach((sentence, sentenceIndex) => {
    for (const extract of ALL_EXTRACTORS) {
      facts.push(...extract(sentence, sentenceIndex))
    }
  })
  return facts
}

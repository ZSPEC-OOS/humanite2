import type { CorpusItem, Domain } from '../types'

// Phase 11 scale-up (10 -> 50 items per domain): word-count bounds for the
// original 60 items were hand-set per item; at 5x the volume, computing
// them from the actual text removes an entire class of transcription error
// (a bound that doesn't actually bracket the item it's attached to) without
// changing what the structural test in corpus.test.ts checks.
export function item(
  id: string,
  domain: Domain,
  input: string,
  mandatoryFacts: string[],
  prohibitedChanges: string[],
  notes?: string,
): CorpusItem {
  const words = input.trim().split(/\s+/).length
  return {
    id,
    domain,
    input,
    mandatoryFacts,
    prohibitedChanges,
    expectedProperties: {
      minWordCount: Math.max(20, words - 20),
      maxWordCount: words + 60,
      ...(notes ? { notes } : {}),
    },
  }
}

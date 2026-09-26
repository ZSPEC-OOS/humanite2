import { splitSentences } from '@/lib/detection/diagnostics/tokenize'
import { alignSentences } from '@/lib/textAlign'
import { buildFactLedger, EXTRACTOR_BY_TYPE } from './factLedger'
import type { FidelityFact } from './types'

export interface FidelityFailure {
  fact: FidelityFact
  reason: string
}

export interface FidelityValidationResult {
  passed: boolean
  failures: FidelityFailure[]
  factCount: number
}

// All fact `data` values are plain objects of strings/nulls built with a
// fixed key order per extractor (see each extractor), so a JSON.stringify
// comparison is a safe, cheap stand-in for structural equality here.
function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

// Binds each fact to the sentence it appears in and checks it holds
// exactly there in the output, rather than checking presence anywhere in
// the document — "Validator binds each quantity and modal to its local
// context (the sentence it appears in)" per the plan's Phase 5 spec. This
// is what catches a range/version/cross-reference/entity swap: the
// individual values all still appear somewhere in the output, but not
// bound to the same sentence (and role) they started in.
export function validateFactLedger(sourceText: string, outputText: string): FidelityValidationResult {
  const sourceFacts = buildFactLedger(sourceText)
  const sourceSentences = splitSentences(sourceText)
  const outputSentences = splitSentences(outputText)
  const alignments = alignSentences(sourceSentences, outputSentences)

  const alignedOutputSentenceBySourceIndex = new Map<number, string>()
  for (const alignment of alignments) {
    alignedOutputSentenceBySourceIndex.set(alignment.sourceIndex, outputSentences[alignment.outputIndex]!)
  }

  const failures: FidelityFailure[] = []

  for (const fact of sourceFacts) {
    const extractor = EXTRACTOR_BY_TYPE[fact.type]
    const alignedSentence = alignedOutputSentenceBySourceIndex.get(fact.sentenceIndex)

    if (alignedSentence !== undefined) {
      const outputFacts = extractor(alignedSentence, fact.sentenceIndex)
      if (outputFacts.some(f => deepEqual(f.data, fact.data))) continue
      failures.push({ fact, reason: `"${fact.text}" (${fact.type}) not found intact in the sentence it aligned to in the output` })
      continue
    }

    // No output sentence matched well enough to call it "the same
    // sentence" — likely a merge/split from intensity-driven restructuring
    // rather than a dropped fact (see Phase 4). Falling back to the whole
    // output text hedges against that false-positive source, at the cost
    // of losing sentence-local precision for this one fact.
    const wholeOutputFacts = extractor(outputText, fact.sentenceIndex)
    if (wholeOutputFacts.some(f => deepEqual(f.data, fact.data))) continue
    failures.push({ fact, reason: `"${fact.text}" (${fact.type}) not found anywhere in the output (its source sentence had no aligned match)` })
  }

  return { passed: failures.length === 0, failures, factCount: sourceFacts.length }
}

import type OpenAI from 'openai'
import { checkTerminologyConsistency, type TerminologyViolation, type AbbreviationGap } from './consistency'
import { repairTerminologyDrift } from './repair'
import { detectToneDrift } from './toneDrift'
import type { DocumentContext } from './types'

// "A final consistency check finds terminology, abbreviation and tone
// drift and repairs only the affected spans" — this runs once, after every
// chunk is generated and joined, since terminology/tone drift are
// document-wide properties that don't exist at the single-chunk scope
// humanizeChunk's own per-chunk repairs (fact ledger, relation repair)
// already cover. Only terminology drift is repaired here (see repair.ts);
// tone drift stays measurement-only (see toneDrift.ts) for the reasons
// documented there.
export interface DocumentConsistencyResult {
  text: string
  terminologyConsistency: number
  terminologyViolations: TerminologyViolation[]
  abbreviationPreservation: number
  abbreviationGaps: AbbreviationGap[]
  terminologyRepair: { attempted: boolean; succeeded: boolean; sentencesRepaired: number }
  toneDriftedChunkCount: number
  toneDriftedChunkIndexes: number[]
}

export async function runDocumentConsistencyPass(
  client: OpenAI,
  model: string,
  postText: string,
  documentContext: DocumentContext,
  chunkTexts: string[],
): Promise<DocumentConsistencyResult> {
  const consistency = checkTerminologyConsistency(documentContext, postText)

  let text = postText
  let terminologyRepair = { attempted: false, succeeded: false, sentencesRepaired: 0 }
  if (consistency.terminologyViolations.length > 0) {
    try {
      const repairResult = await repairTerminologyDrift(client, model, postText, consistency.terminologyViolations)
      terminologyRepair = {
        attempted: repairResult.attempted,
        succeeded: repairResult.succeeded,
        sentencesRepaired: repairResult.sentencesRepaired,
      }
      if (repairResult.succeeded) text = repairResult.text
    } catch (err) {
      console.warn('Terminology drift repair unavailable, shipping the pre-repair text instead', {
        type: err instanceof Error ? err.constructor.name : typeof err,
      })
    }
  }

  const toneDrift = detectToneDrift(chunkTexts)

  return {
    text,
    terminologyConsistency: consistency.terminologyConsistency,
    terminologyViolations: consistency.terminologyViolations,
    abbreviationPreservation: consistency.abbreviationPreservation,
    abbreviationGaps: consistency.abbreviationGaps,
    terminologyRepair,
    toneDriftedChunkCount: toneDrift.driftedChunkIndexes.length,
    toneDriftedChunkIndexes: toneDrift.driftedChunkIndexes,
  }
}

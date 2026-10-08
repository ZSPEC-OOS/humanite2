import type OpenAI from 'openai'
import { preprocess } from '@/lib/preprocess'
import { humanizeChunk, type ChunkResult } from '@/lib/humanizePipeline'
import { buildDocumentContext, emptyDocumentContext, runDocumentConsistencyPass, type DocumentContext, type DocumentConsistencyResult } from '@/lib/document'
import { toValidGenre, toValidAudience } from '@/lib/style/types'
import { effectiveIntensity } from '@/lib/intensity'
import type { Domain } from '@/lib/style/types'

const DEFAULT_MAX_GATE_RETRIES = 2

// Best-effort — a document without unusual terminology, abbreviations, or
// section structure gets no less service from this failing than from
// succeeding; see buildDocumentContext's own budget note (capped analysis
// text, capped extraction counts) for why this stays a single call rather
// than something worth retrying. Shared (not duplicated) so production and
// the benchmark can never drift on what "best-effort" means here.
export async function buildDocumentContextSafely(
  client: OpenAI,
  model: string,
  sourceText: string,
  genre: string | null,
  audience: string | null,
): Promise<DocumentContext> {
  const validGenre = toValidGenre(genre)
  const validAudience = toValidAudience(audience)
  try {
    return await buildDocumentContext(client, model, sourceText, validGenre, validAudience)
  } catch (err) {
    console.warn('Document context analysis unavailable, continuing without cross-chunk consistency data', {
      type: err instanceof Error ? err.constructor.name : typeof err,
    })
    return emptyDocumentContext(validGenre, validAudience)
  }
}

export interface RunHumaniteDocumentParams {
  client: OpenAI
  model: string
  sourceText: string
  requestedIntensity: number
  tone: string
  domain: Domain
  genre?: string | null
  audience?: string | null
  // A single-candidate benchmark arm needs to force candidateCount=1 regardless
  // of what the (capped) applied intensity would otherwise select — see
  // humanizeChunk's own candidateCountOverride parameter.
  candidateCountOverride?: number | null
  maxGateRetries?: number
}

export interface RunHumaniteDocumentResult {
  text: string
  requestedIntensity: number
  appliedIntensity: number
  intensityCapped: boolean
  modelUsed: string
  chunkResult: ChunkResult
  consistency: DocumentConsistencyResult
  modelCalls: number | null
  inputTokens: number | null
  outputTokens: number | null
  retryCount: number
  candidateCount: number
}

// The ONE production-fidelity synchronous document transformation path —
// preprocess -> effectiveIntensity -> document context -> humanizeChunk ->
// document consistency pass. This is exactly the sequence
// /api/v1/humanize's synchronous branch already ran inline; it is now
// factored out here so that branch AND the internal benchmark service call
// the exact same code, instead of two hand-maintained copies that can silently drift (see the Phase "Final
// Polish" patch's blocker #1/#4: the benchmark was previously sending the
// RAW requested intensity straight to humanizeChunk, bypassing production's
// domain intensity caps entirely).
//
// Deliberately does NOT cover the long-document chunked/async path (§5 of
// that patch) — chunking, per-chunk persistence, and joinChunkResults stay
// in the async orchestration; only the effective-intensity/document-context/
// consistency-pass semantics need to be shared, and this helper is small
// enough for the async path to reuse per-chunk if that's ever worthwhile
// without forcing a rewrite of it now.
export async function runHumaniteDocument(params: RunHumaniteDocumentParams): Promise<RunHumaniteDocumentResult> {
  const {
    client, model, sourceText, requestedIntensity, tone, domain,
    genre = null, audience = null, candidateCountOverride = null, maxGateRetries = DEFAULT_MAX_GATE_RETRIES,
  } = params

  const prep = preprocess(sourceText)
  const effective = effectiveIntensity(requestedIntensity, domain)
  const documentContext = await buildDocumentContextSafely(client, model, prep.sanitized_text, genre, audience)

  const chunkResult = await humanizeChunk(
    client, model, sourceText, prep.sanitized_text, prep.fact_locks,
    effective.applied, tone, domain, maxGateRetries,
    genre, audience, documentContext, candidateCountOverride,
  )
  const consistency = await runDocumentConsistencyPass(client, model, chunkResult.text, documentContext, [chunkResult.text])

  return {
    text: consistency.text,
    requestedIntensity: effective.requested,
    appliedIntensity: effective.applied,
    intensityCapped: effective.capped,
    modelUsed: chunkResult.modelUsed,
    chunkResult,
    consistency,
    modelCalls: chunkResult.modelCalls,
    inputTokens: chunkResult.inputTokens,
    outputTokens: chunkResult.outputTokens,
    retryCount: chunkResult.retryCount,
    candidateCount: chunkResult.candidateSelection.candidateCount,
  }
}

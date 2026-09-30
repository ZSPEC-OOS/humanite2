import type { Firestore } from 'firebase-admin/firestore'
import { createHash } from 'crypto'
import type OpenAI from 'openai'
import { preprocess } from '@/lib/preprocess'
import { humanizeChunk } from '@/lib/humanizePipeline'
import { buildDocumentContext, emptyDocumentContext, runDocumentConsistencyPass, type DocumentContext } from '@/lib/document'
import { A2H_COLLECTIONS, type CorpusSource, type BenchmarkOutput, type BenchmarkOutputStatus } from './types'

const COLLECTION = A2H_COLLECTIONS.outputs
const MAX_GATE_RETRIES = 2
// Tone is held fixed across every A2H-01/02/03 measurement — per the spec's
// core experimental principle, intensity is the one repeated-measures
// factor; varying tone here would confound it. Style/tone itself is what
// A2H-11 measures separately, on its own fixture set, not this path.
const FIXED_TONE = 'balanced'

// Scoped by runId, not just sourceId x intensity — two Benchmark Runs
// against the same frozen source (a different model, a repeat for
// statistical power) must never share or overwrite each other's outputs.
// Enforces UNIQUE(runId, sourceId, intensity) by construction.
function outputDocId(runId: string, sourceId: string, intensity: number): string {
  return `${runId}__${sourceId}__${intensity}`
}

function wordCount(text: string): number {
  const trimmed = text.trim()
  return trimmed ? trimmed.split(/\s+/).length : 0
}

export async function getOutput(firestore: Firestore, runId: string, sourceId: string, intensity: number): Promise<BenchmarkOutput | null> {
  const doc = await firestore.collection(COLLECTION).doc(outputDocId(runId, sourceId, intensity)).get()
  return doc.exists ? (doc.data() as BenchmarkOutput) : null
}

// An output's own id already IS its deterministic (runId, sourceId,
// intensity) key — a caller that only holds that id (a post_gptzero or
// test_evaluation BenchmarkJob carries outputId directly) can fetch it
// without re-deriving the other parts.
export async function getOutputById(firestore: Firestore, outputId: string): Promise<BenchmarkOutput | null> {
  const doc = await firestore.collection(COLLECTION).doc(outputId).get()
  return doc.exists ? (doc.data() as BenchmarkOutput) : null
}

export async function listOutputsForSource(firestore: Firestore, runId: string, sourceId: string): Promise<BenchmarkOutput[]> {
  const snap = await firestore.collection(COLLECTION).where('runId', '==', runId).where('sourceId', '==', sourceId).get()
  return snap.docs.map(d => d.data() as BenchmarkOutput).sort((a, b) => a.intensity - b.intensity)
}

export async function listOutputsForRun(firestore: Firestore, runId: string): Promise<BenchmarkOutput[]> {
  const snap = await firestore.collection(COLLECTION).where('runId', '==', runId).get()
  return snap.docs.map(d => d.data() as BenchmarkOutput)
}

// Best-effort, matching /v1/humanize's own buildDocumentContextSafely — a
// document without unusual terminology/abbreviations/structure loses
// nothing from this failing rather than succeeding.
async function safeDocumentContext(client: OpenAI, model: string, text: string): Promise<DocumentContext> {
  try {
    return await buildDocumentContext(client, model, text, null, null)
  } catch (err) {
    console.warn('A2H: document context analysis unavailable, continuing without cross-chunk consistency data', {
      type: err instanceof Error ? err.constructor.name : typeof err,
    })
    return emptyDocumentContext(null, null)
  }
}

export interface TransformSourceParams {
  runId: string
  source: CorpusSource
  intensity: number
  client: OpenAI
  model: string
  modelProvider: string
  // Phase 5: null for an unreleased run. When set, forceOverwrite is refused
  // outright — a released run's evidence is frozen (see release.ts); a
  // corrected re-execution belongs to a NEW BenchmarkRun, never a mutation
  // of a released one's outputs.
  releasedAt?: string | null
}

// Runs the real Humanize pipeline (preprocess -> humanizeChunk -> document
// consistency pass — the exact synchronous path /v1/humanize itself takes,
// since every A2H source is well under SYNC_MAX_CHARS) against a frozen
// source at one intensity, within one Benchmark Run. Only a frozen source
// qualifies — an un-frozen source's text isn't yet the immutable unit the
// rest of the benchmark's comparability depends on.
//
// Idempotent by default (§26): an existing SUCCESSFUL output for this exact
// (runId, sourceId, intensity) is returned as-is, without any new model
// call — this is what makes a resumed run, a retried job, or a page refresh
// safe from duplicating paid work. A FAILED output always retries freely
// (no force needed), the same policy corpus.ts's generateSource uses for a
// validation_failed source. forceOverwrite is reserved for an explicit
// administrator regeneration of an already-successful output.
//
// Phase 5: modelCalls/inputTokens/outputTokens are populated from
// humanizeChunk's own telemetry (real, though partial — see
// humanizePipeline.ts's ChunkResult comment: it counts only the primary
// generation-phase completions, not internal gate/judge/repair/claim calls).
// estimatedCostUsd stays null — no pricing-per-token configuration exists in
// this codebase, and none is fabricated here.
export async function transformSource(
  firestore: Firestore,
  params: TransformSourceParams,
  forceOverwrite = false,
): Promise<BenchmarkOutput> {
  const { runId, source, intensity, client, model, modelProvider } = params
  if (source.status !== 'frozen') {
    throw new Error(`Cannot transform a source with status '${source.status}' — only a frozen source qualifies.`)
  }
  if (!Number.isInteger(intensity) || intensity < 1 || intensity > 10) {
    throw new Error('intensity must be an integer between 1 and 10')
  }
  if (forceOverwrite && params.releasedAt) {
    throw new Error('Cannot regenerate an output — this run has been released; its evidence is frozen. Start a new run instead.')
  }

  const existing = await getOutput(firestore, runId, source.id, intensity)
  if (existing && existing.status === 'success' && !forceOverwrite) {
    return existing
  }

  const id = outputDocId(runId, source.id, intensity)
  const prep = preprocess(source.text)
  const start = Date.now()

  let status: BenchmarkOutputStatus = 'success'
  let errorCode: string | null = null
  let errorMessage: string | null = null
  let outputText = ''
  let modelUsed = model
  let retryCount = 0
  let candidateCount = 1
  let modelCalls: number | null = null
  let inputTokens: number | null = null
  let outputTokens: number | null = null

  try {
    const documentContext = await safeDocumentContext(client, model, prep.sanitized_text)
    const result = await humanizeChunk(
      client, model, source.text, prep.sanitized_text, prep.fact_locks,
      intensity, FIXED_TONE, source.domainId, MAX_GATE_RETRIES,
      null, null, documentContext,
    )
    const consistency = await runDocumentConsistencyPass(client, model, result.text, documentContext, [result.text])
    outputText = consistency.text
    modelUsed = result.modelUsed
    retryCount = result.retryCount
    candidateCount = result.candidateSelection.candidateCount
    modelCalls = result.modelCalls
    inputTokens = result.inputTokens
    outputTokens = result.outputTokens
  } catch (err) {
    status = 'failed'
    errorCode = err instanceof Error ? err.constructor.name : 'UnknownError'
    errorMessage = err instanceof Error ? err.message : 'Transformation failed.'
  }

  const latencyMs = Date.now() - start
  const output: BenchmarkOutput = {
    id,
    runId,
    corpusProjectId: source.corpusProjectId,
    sourceId: source.id,
    domainId: source.domainId,
    topicId: source.topicId,
    targetWords: source.targetWords,
    intensity,
    outputText,
    outputWords: status === 'success' ? wordCount(outputText) : 0,
    outputSha256: status === 'success' ? createHash('sha256').update(outputText).digest('hex') : '',
    modelProvider,
    model: modelUsed,
    retryCount,
    candidateCount: status === 'success' ? candidateCount : null,
    modelCalls: status === 'success' ? modelCalls : null,
    latencyMs,
    inputTokens: status === 'success' ? inputTokens : null,
    outputTokens: status === 'success' ? outputTokens : null,
    estimatedCostUsd: null,
    generatedAt: new Date().toISOString(),
    status,
    errorCode,
    errorMessage,
  }

  await firestore.collection(COLLECTION).doc(id).set(output)
  if (status === 'failed') throw new Error(errorMessage ?? 'Transformation failed.')
  return output
}

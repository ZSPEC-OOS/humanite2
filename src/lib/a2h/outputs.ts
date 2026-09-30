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

function outputDocId(sourceId: string, intensity: number): string {
  return `${sourceId}__I${intensity}`
}

function wordCount(text: string): number {
  const trimmed = text.trim()
  return trimmed ? trimmed.split(/\s+/).length : 0
}

export async function getOutput(firestore: Firestore, sourceId: string, intensity: number): Promise<BenchmarkOutput | null> {
  const doc = await firestore.collection(COLLECTION).doc(outputDocId(sourceId, intensity)).get()
  return doc.exists ? (doc.data() as BenchmarkOutput) : null
}

export async function listOutputsForSource(firestore: Firestore, sourceId: string): Promise<BenchmarkOutput[]> {
  const snap = await firestore.collection(COLLECTION).where('sourceId', '==', sourceId).get()
  return snap.docs.map(d => d.data() as BenchmarkOutput).sort((a, b) => a.intensity - b.intensity)
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
  source: CorpusSource
  intensity: number
  client: OpenAI
  model: string
}

// Runs the real Humanize pipeline (preprocess -> humanizeChunk -> document
// consistency pass — the exact synchronous path /v1/humanize itself takes,
// since every A2H source is well under SYNC_MAX_CHARS) against a frozen
// source at one intensity, so this benchmark measures the actual product
// behavior rather than a simplified stand-in. Only a frozen source
// qualifies — an un-frozen source's text isn't yet the immutable unit the
// rest of the benchmark's comparability depends on.
//
// Known gap: humanizeChunk doesn't surface completion token usage, so
// inputTokens/outputTokens/estimatedCostUsd are left null rather than
// fabricated. Revisit when A2H-17 (Operational Efficiency) is built.
export async function transformSource(
  firestore: Firestore,
  params: TransformSourceParams,
  forceOverwrite = false,
): Promise<BenchmarkOutput> {
  const { source, intensity, client, model } = params
  if (source.status !== 'frozen') {
    throw new Error(`Cannot transform a source with status '${source.status}' — only a frozen source qualifies.`)
  }
  if (!Number.isInteger(intensity) || intensity < 1 || intensity > 10) {
    throw new Error('intensity must be an integer between 1 and 10')
  }

  const existing = await getOutput(firestore, source.id, intensity)
  if (existing && existing.status === 'success' && !forceOverwrite) {
    throw new Error('An output already exists for this source/intensity — pass force to regenerate.')
  }

  const id = outputDocId(source.id, intensity)
  const prep = preprocess(source.text)
  const start = Date.now()

  let status: BenchmarkOutputStatus = 'success'
  let errorMessage: string | null = null
  let outputText = ''
  let modelUsed = model
  let retryCount = 0
  let candidateCount = 1

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
  } catch (err) {
    status = 'failed'
    errorMessage = err instanceof Error ? err.message : 'Transformation failed.'
  }

  const latencyMs = Date.now() - start
  const output: BenchmarkOutput = {
    id,
    corpusProjectId: source.corpusProjectId,
    sourceId: source.id,
    domainId: source.domainId,
    topicId: source.topicId,
    targetWords: source.targetWords,
    intensity,
    outputText,
    outputWords: status === 'success' ? wordCount(outputText) : 0,
    outputSha256: status === 'success' ? createHash('sha256').update(outputText).digest('hex') : '',
    modelUsed,
    retryCount,
    candidateCount,
    latencyMs,
    inputTokens: null,
    outputTokens: null,
    estimatedCostUsd: null,
    generatedAt: new Date().toISOString(),
    status,
    errorMessage,
  }

  await firestore.collection(COLLECTION).doc(id).set(output)
  if (status === 'failed') throw new Error(errorMessage ?? 'Transformation failed.')
  return output
}

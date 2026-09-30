import type { Firestore } from 'firebase-admin/firestore'
import { createHash } from 'crypto'
import type OpenAI from 'openai'
import { runHumaniteDocument } from '@/lib/runHumaniteDocument'
import { effectiveIntensity } from '@/lib/intensity'
import { A2H_COLLECTIONS, type CorpusSource, type BenchmarkOutput, type BenchmarkOutputStatus } from './types'

const COLLECTION = A2H_COLLECTIONS.outputs
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

// Runs the real Humanize pipeline via the SAME shared runHumaniteDocument
// helper /v1/humanize's synchronous path uses (preprocess -> effective
// intensity -> document context -> humanizeChunk -> document consistency
// pass — every A2H source is well under SYNC_MAX_CHARS) against a frozen
// source at one intensity, within one Benchmark Run. Only a frozen source
// qualifies — an un-frozen source's text isn't yet the immutable unit the
// rest of the benchmark's comparability depends on.
//
// "Final Polish" patch, blocker #1: this used to send the raw benchmark
// intensity straight to humanizeChunk, bypassing production's per-domain
// intensity caps entirely — a medical source at requested intensity 10 was
// actually humanized at intensity 10, when the real product would have
// capped it to 5. Going through runHumaniteDocument means every A2H output
// now receives EXACTLY the same effective-intensity policy a real user's
// request would.
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
  // Pure and deterministic from (requested, domain) — computed once here so
  // both the success AND failure paths below record the same honest
  // requested/applied/capped values, regardless of whether the paid call
  // itself succeeded.
  const effective = effectiveIntensity(intensity, source.domainId)
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
    const generated = await runHumaniteDocument({
      client, model, sourceText: source.text, requestedIntensity: intensity, tone: FIXED_TONE, domain: source.domainId,
    })
    outputText = generated.text
    modelUsed = generated.modelUsed
    retryCount = generated.retryCount
    candidateCount = generated.candidateCount
    modelCalls = generated.modelCalls
    inputTokens = generated.inputTokens
    outputTokens = generated.outputTokens
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
    requestedIntensity: effective.requested,
    appliedIntensity: effective.applied,
    intensityCapped: effective.capped,
    outputText,
    outputWords: status === 'success' ? wordCount(outputText) : 0,
    outputSha256: status === 'success' ? createHash('sha256').update(outputText).digest('hex') : '',
    modelProvider,
    model: modelUsed,
    retryCount,
    candidateCount: status === 'success' ? candidateCount : null,
    modelCalls: status === 'success' ? modelCalls : null,
    telemetryScope: 'primary_generation_only',
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

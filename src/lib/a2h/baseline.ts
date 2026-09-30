import type { Firestore } from 'firebase-admin/firestore'
import { GPTZeroProvider } from '@/lib/detection/providers/gptzero'
import { A2H_COLLECTIONS, DEFAULT_DETECTOR_CONFIG_ID, type CorpusSource, type BenchmarkOutput, type BenchmarkRun, type DetectorResult } from './types'
import { listRunSources } from './runs'
import { listOutputsForRun } from './outputs'

const COLLECTION = A2H_COLLECTIONS.detectorResults

// A baseline's identity is (sourceId, detectorConfigId) alone — deliberately
// NOT including runId — so the exact same frozen source scored under the
// exact same detector configuration is never paid for twice just because a
// second Benchmark Run references it (§8). A post-transform score's
// identity is (outputId, detectorConfigId); outputId already encodes runId
// (see outputs.ts), so post-scores are naturally run-scoped without needing
// runId in this key too.
function baselineDocId(sourceId: string, detectorConfigId: string): string {
  return `baseline__${sourceId}__${detectorConfigId}`
}
function postScoreDocId(outputId: string, detectorConfigId: string): string {
  return `postscore__${outputId}__${detectorConfigId}`
}

async function getDetectorResult(firestore: Firestore, id: string): Promise<DetectorResult | null> {
  const doc = await firestore.collection(COLLECTION).doc(id).get()
  return doc.exists ? (doc.data() as DetectorResult) : null
}

async function runGPTZero(text: string, apiKey: string): Promise<Pick<DetectorResult, 'detector' | 'aiProbability' | 'humanProbability' | 'mixedProbability' | 'classification' | 'analyzedAt' | 'rawResponse' | 'latencyMs'>> {
  const provider = new GPTZeroProvider(apiKey)
  const start = Date.now()
  const { result, raw } = await provider.detectWithRaw(text)
  return {
    detector: 'gptzero',
    aiProbability: result.probabilities.ai,
    humanProbability: result.probabilities.human,
    mixedProbability: result.probabilities.mixed,
    classification: result.classification,
    analyzedAt: new Date().toISOString(),
    rawResponse: raw,
    latencyMs: Date.now() - start,
  }
}

// Exposed for the experimental-trial tests (A2H-07/A2H-15, Phase 4), which
// score ad hoc trial text that has no corresponding DetectorResult row of its
// own (a BenchmarkTrial isn't a BenchmarkOutput) — never persisted through
// this module's own baseline/postScore collection, so callers persist the
// probability/classification directly on their own BenchmarkTrial record.
export async function scoreTextWithGPTZero(text: string, apiKey: string): Promise<{ aiProbability: number | null; humanProbability: number | null; classification: DetectorResult['classification'] }> {
  const scored = await runGPTZero(text, apiKey)
  return { aiProbability: scored.aiProbability, humanProbability: scored.humanProbability, classification: scored.classification }
}

export async function getBaseline(firestore: Firestore, sourceId: string, detectorConfigId: string): Promise<DetectorResult | null> {
  return getDetectorResult(firestore, baselineDocId(sourceId, detectorConfigId))
}

export async function getPostScore(firestore: Firestore, outputId: string, detectorConfigId: string): Promise<DetectorResult | null> {
  return getDetectorResult(firestore, postScoreDocId(outputId, detectorConfigId))
}

// Individual lookups rather than a Firestore `in` query (capped at 30
// values) — fine for a run's cohort (hundreds to low thousands of sources),
// not a hot path.
export async function listBaselinesForSources(firestore: Firestore, sourceIds: string[], detectorConfigId: string): Promise<Record<string, DetectorResult>> {
  const entries = await Promise.all(sourceIds.map(async id => [id, await getBaseline(firestore, id, detectorConfigId)] as const))
  const map: Record<string, DetectorResult> = {}
  for (const [id, result] of entries) if (result) map[id] = result
  return map
}

export async function listPostScoresForOutputs(firestore: Firestore, outputIds: string[], detectorConfigId: string): Promise<Record<string, DetectorResult>> {
  const entries = await Promise.all(outputIds.map(async id => [id, await getPostScore(firestore, id, detectorConfigId)] as const))
  const map: Record<string, DetectorResult> = {}
  for (const [id, result] of entries) if (result) map[id] = result
  return map
}

// Phase 5 export layer, superseded by listDetectorEvidenceForRun below —
// kept only because it's a plain, cheap "what does this run's OWN runId
// field say" query some other read path might still want; do not use this
// for exports, release hashing, or anything claiming completeness. See
// listDetectorEvidenceForRun's own comment for why runId-based filtering
// is wrong for that purpose (blocker #10 of the "Final Polish" patch).
export async function listDetectorResultsForRun(firestore: Firestore, runId: string): Promise<DetectorResult[]> {
  const snap = await firestore.collection(COLLECTION).where('runId', '==', runId).get()
  return snap.docs.map(d => d.data() as DetectorResult)
}

// §10-11 of the "Final Polish" patch: a baseline's identity is
// (sourceId, detectorConfigId) — deliberately NOT scoped by runId, so the
// SAME source scored under the SAME detector configuration is never paid
// for twice across runs (§8). That means a baseline's own `runId` field
// only records which run happened to create it FIRST — a run that REUSES
// an older baseline never appears as that baseline's `runId`, even though
// its own A2H-01/02 measurements depend on it. `where('runId', '==', runId)`
// (the old listDetectorResultsForRun) therefore silently omits every reused
// baseline from a run's detector export and release hashes — an incomplete
// research package with no error or warning.
//
// The correct definition of "detector evidence for this run" is LOGICAL,
// not a stored field: every baseline actually used by this run's source
// cohort, plus every post-score actually used by this run's own outputs —
// regardless of which run's runId a shared baseline happens to carry.
export async function listDetectorEvidenceForRun(firestore: Firestore, run: BenchmarkRun): Promise<DetectorResult[]> {
  const detectorConfigId = run.detectorConfigId ?? DEFAULT_DETECTOR_CONFIG_ID
  const [cohort, outputs] = await Promise.all([
    listRunSources(firestore, run.id),
    listOutputsForRun(firestore, run.id),
  ])
  const successfulOutputs = outputs.filter(o => o.status === 'success')

  const [baselines, postScores] = await Promise.all([
    listBaselinesForSources(firestore, cohort.map(row => row.sourceId), detectorConfigId),
    listPostScoresForOutputs(firestore, successfulOutputs.map(o => o.id), detectorConfigId),
  ])

  const byId = new Map<string, DetectorResult>()
  for (const result of Object.values(baselines)) byId.set(result.id, result)
  for (const result of Object.values(postScores)) byId.set(result.id, result)
  return [...byId.values()]
}

export interface AcquireBaselineParams {
  source: CorpusSource
  runId: string
  detectorConfigId: string
  apiKey: string
}

// Acquires (or reuses) the one GPTZero baseline a frozen source has per
// detector configuration, regardless of which run asks for it first — the
// core of §8's "do not pay for the same baseline repeatedly across runs"
// requirement. `runId` is recorded only as provenance (which run first
// produced this baseline); it is never part of the lookup key. Always calls
// GPTZero directly — never the product's swappable DetectionGateway —
// because §1 names GPTZero specifically as this benchmark's primary
// detector, independent of whatever DETECTION_PROVIDER this deployment
// happens to run for ordinary scan/humanize traffic.
export async function acquireBaseline(firestore: Firestore, params: AcquireBaselineParams, forceOverwrite = false): Promise<DetectorResult> {
  const { source, runId, detectorConfigId, apiKey } = params
  if (source.status !== 'frozen') {
    throw new Error(`Cannot acquire a baseline for a source with status '${source.status}' — only a frozen source qualifies.`)
  }
  const existing = await getBaseline(firestore, source.id, detectorConfigId)
  if (existing && !forceOverwrite) return existing

  const scored = await runGPTZero(source.text, apiKey)
  const baseline: DetectorResult = {
    id: baselineDocId(source.id, detectorConfigId),
    corpusProjectId: source.corpusProjectId,
    runId,
    sourceId: source.id,
    outputId: null,
    detectorConfigId,
    stage: 'baseline',
    ...scored,
  }
  await firestore.collection(COLLECTION).doc(baseline.id).set(baseline)
  return baseline
}

export interface AcquirePostScoreParams {
  output: BenchmarkOutput
  detectorConfigId: string
  apiKey: string
}

// The after half of A2H-01's primary measurement (deltaAiProbability =
// aiProbabilityBefore - aiProbabilityAfter) — run against a completed,
// run-scoped BenchmarkOutput. Idempotent the same way as acquireBaseline: a
// resumed run or a retried job reuses the existing score for this exact
// output rather than re-calling GPTZero.
export async function acquirePostScore(firestore: Firestore, params: AcquirePostScoreParams, forceOverwrite = false): Promise<DetectorResult> {
  const { output, detectorConfigId, apiKey } = params
  if (output.status !== 'success') {
    throw new Error('Cannot score a failed transformation output.')
  }
  const existing = await getPostScore(firestore, output.id, detectorConfigId)
  if (existing && !forceOverwrite) return existing

  const scored = await runGPTZero(output.outputText, apiKey)
  const postScore: DetectorResult = {
    id: postScoreDocId(output.id, detectorConfigId),
    corpusProjectId: output.corpusProjectId,
    runId: output.runId,
    sourceId: output.sourceId,
    outputId: output.id,
    detectorConfigId,
    stage: 'post_transform',
    ...scored,
  }
  await firestore.collection(COLLECTION).doc(postScore.id).set(postScore)
  return postScore
}

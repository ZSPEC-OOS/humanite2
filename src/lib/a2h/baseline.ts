import type { Firestore } from 'firebase-admin/firestore'
import { GPTZeroProvider } from '@/lib/detection/providers/gptzero'
import type { DetectionClassification } from '@/lib/detection/contracts'
import type { CorpusSource, BenchmarkOutput } from './types'

const COLLECTION = 'a2hDetectorResults'

// Per §9.1 — the complete raw GPTZero response is retained alongside the
// normalized fields so every derived summary stays reproducible from stored
// raw records, never just from the normalized numbers. outputId is null for
// a pre-transform baseline (keyed by sourceId alone) and set for a
// post-transform score (keyed by the BenchmarkOutput's own id).
export interface DetectorResult {
  id: string
  corpusProjectId: string
  sourceId: string
  outputId: string | null
  detector: 'gptzero'
  aiProbability: number | null
  humanProbability: number | null
  mixedProbability: number | null
  classification: DetectionClassification
  analyzedAt: string
  rawResponse: unknown
}

async function getDetectorResult(firestore: Firestore, id: string): Promise<DetectorResult | null> {
  const doc = await firestore.collection(COLLECTION).doc(id).get()
  return doc.exists ? (doc.data() as DetectorResult) : null
}

// Individual lookups rather than a Firestore `in` query (capped at 30
// values) — fine for an admin tool operating on one domain's slice (up to
// 200 sources) or one source's 10 outputs at a time, not a hot path.
async function listDetectorResults(firestore: Firestore, ids: string[]): Promise<Record<string, DetectorResult>> {
  const entries = await Promise.all(ids.map(async id => [id, await getDetectorResult(firestore, id)] as const))
  const map: Record<string, DetectorResult> = {}
  for (const [id, result] of entries) {
    if (result) map[id] = result
  }
  return map
}

async function runGPTZero(text: string, apiKey: string): Promise<Pick<DetectorResult, 'detector' | 'aiProbability' | 'humanProbability' | 'mixedProbability' | 'classification' | 'analyzedAt' | 'rawResponse'>> {
  const provider = new GPTZeroProvider(apiKey)
  const { result, raw } = await provider.detectWithRaw(text)
  return {
    detector: 'gptzero',
    aiProbability: result.probabilities.ai,
    humanProbability: result.probabilities.human,
    mixedProbability: result.probabilities.mixed,
    classification: result.classification,
    analyzedAt: new Date().toISOString(),
    rawResponse: raw,
  }
}

export async function getBaseline(firestore: Firestore, sourceId: string): Promise<DetectorResult | null> {
  return getDetectorResult(firestore, sourceId)
}

export async function listBaselines(firestore: Firestore, sourceIds: string[]): Promise<Record<string, DetectorResult>> {
  return listDetectorResults(firestore, sourceIds)
}

export async function getPostScore(firestore: Firestore, outputId: string): Promise<DetectorResult | null> {
  return getDetectorResult(firestore, outputId)
}

export async function listPostScores(firestore: Firestore, outputIds: string[]): Promise<Record<string, DetectorResult>> {
  return listDetectorResults(firestore, outputIds)
}

// Acquires (or re-acquires, with forceOverwrite) the one GPTZero baseline a
// frozen source is allowed per §22 ("exactly one stored GPTZero baseline per
// detector configuration"). Always calls GPTZero directly — never the
// product's swappable DetectionGateway — because §1 names GPTZero
// specifically as this benchmark's primary detector, independent of
// whatever DETECTION_PROVIDER this deployment happens to run for ordinary
// scan/humanize traffic.
export async function acquireBaseline(
  firestore: Firestore,
  source: CorpusSource,
  apiKey: string,
  forceOverwrite = false,
): Promise<DetectorResult> {
  if (source.status !== 'frozen') {
    throw new Error(`Cannot acquire a baseline for a source with status '${source.status}' — only a frozen source qualifies.`)
  }
  const existing = await getBaseline(firestore, source.id)
  if (existing && !forceOverwrite) {
    throw new Error('A baseline already exists for this source — pass force to re-acquire.')
  }

  const scored = await runGPTZero(source.text, apiKey)
  const baseline: DetectorResult = { id: source.id, corpusProjectId: source.corpusProjectId, sourceId: source.id, outputId: null, ...scored }
  await firestore.collection(COLLECTION).doc(source.id).set(baseline)
  return baseline
}

// The after half of A2H-01's primary measurement (Delta AI = P(AI,before) -
// P(AI,after)) — same GPTZero-direct posture as acquireBaseline, run against
// a completed BenchmarkOutput rather than the frozen source.
export async function acquirePostScore(
  firestore: Firestore,
  output: BenchmarkOutput,
  apiKey: string,
  forceOverwrite = false,
): Promise<DetectorResult> {
  if (output.status !== 'success') {
    throw new Error('Cannot score a failed transformation output.')
  }
  const existing = await getPostScore(firestore, output.id)
  if (existing && !forceOverwrite) {
    throw new Error('A post-transform score already exists for this output — pass force to re-acquire.')
  }

  const scored = await runGPTZero(output.outputText, apiKey)
  const postScore: DetectorResult = { id: output.id, corpusProjectId: output.corpusProjectId, sourceId: output.sourceId, outputId: output.id, ...scored }
  await firestore.collection(COLLECTION).doc(output.id).set(postScore)
  return postScore
}

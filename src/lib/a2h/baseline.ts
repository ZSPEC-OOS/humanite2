import type { Firestore } from 'firebase-admin/firestore'
import { GPTZeroProvider } from '@/lib/detection/providers/gptzero'
import type { DetectionClassification } from '@/lib/detection/contracts'
import type { CorpusSource } from './types'

const COLLECTION = 'a2hDetectorResults'

// Per §9.1 — the complete raw GPTZero response is retained alongside the
// normalized fields so every derived summary stays reproducible from stored
// raw records, never just from the normalized numbers.
export interface DetectorResult {
  id: string
  sourceId: string
  detector: 'gptzero'
  aiProbability: number | null
  humanProbability: number | null
  mixedProbability: number | null
  classification: DetectionClassification
  analyzedAt: string
  rawResponse: unknown
}

export async function getBaseline(firestore: Firestore, sourceId: string): Promise<DetectorResult | null> {
  const doc = await firestore.collection(COLLECTION).doc(sourceId).get()
  return doc.exists ? (doc.data() as DetectorResult) : null
}

// Individual lookups rather than a Firestore `in` query (capped at 30
// values) — fine for an admin tool operating on one domain's slice (up to
// 200 sources) at a time, not a hot path.
export async function listBaselines(firestore: Firestore, sourceIds: string[]): Promise<Record<string, DetectorResult>> {
  const entries = await Promise.all(sourceIds.map(async id => [id, await getBaseline(firestore, id)] as const))
  const map: Record<string, DetectorResult> = {}
  for (const [id, result] of entries) {
    if (result) map[id] = result
  }
  return map
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

  const provider = new GPTZeroProvider(apiKey)
  const { result, raw } = await provider.detectWithRaw(source.text)

  const baseline: DetectorResult = {
    id: source.id,
    sourceId: source.id,
    detector: 'gptzero',
    aiProbability: result.probabilities.ai,
    humanProbability: result.probabilities.human,
    mixedProbability: result.probabilities.mixed,
    classification: result.classification,
    analyzedAt: new Date().toISOString(),
    rawResponse: raw,
  }
  await firestore.collection(COLLECTION).doc(source.id).set(baseline)
  return baseline
}

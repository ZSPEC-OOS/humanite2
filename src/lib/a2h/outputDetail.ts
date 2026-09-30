import type { Firestore } from 'firebase-admin/firestore'
import { DEFAULT_DETECTOR_CONFIG_ID, type BenchmarkOutput, type BenchmarkTopic, type CorpusSource, type DetectorResult } from './types'
import { getSourceById } from './corpus'
import { getTopic } from './topics'
import { getOutputById } from './outputs'
import { getBaseline, getPostScore } from './baseline'
import { getRun } from './runs'

// The reusable document-detail record every later A2H test (A2H-04..17) will
// also want — one output, its source, its topic, and both of its GPTZero
// scores, joined from already-persisted rows so every field here is
// independently re-derivable from the underlying collections (§21). Later
// phases add diff/preservation/grammar/fixtures sections on top of this same
// shape rather than replacing it.
export interface OutputDetail {
  output: BenchmarkOutput
  source: CorpusSource
  topic: BenchmarkTopic
  baseline: DetectorResult | null
  postScore: DetectorResult | null
}

export async function getOutputDetail(firestore: Firestore, runId: string, outputId: string): Promise<OutputDetail | null> {
  const output = await getOutputById(firestore, outputId)
  if (!output || output.runId !== runId) return null

  const [source, topic, run] = await Promise.all([
    getSourceById(firestore, output.sourceId),
    getTopic(firestore, output.topicId),
    getRun(firestore, runId),
  ])
  if (!source || !topic) return null

  const detectorConfigId = run?.detectorConfigId ?? DEFAULT_DETECTOR_CONFIG_ID
  const [baseline, postScore] = await Promise.all([
    getBaseline(firestore, output.sourceId, detectorConfigId),
    getPostScore(firestore, output.id, detectorConfigId),
  ])

  return { output, source, topic, baseline, postScore }
}

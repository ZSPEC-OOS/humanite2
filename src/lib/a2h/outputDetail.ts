import type { Firestore } from 'firebase-admin/firestore'
import {
  DEFAULT_DETECTOR_CONFIG_ID, FIXTURE_REQUIRING_TESTS,
  type BenchmarkOutput, type BenchmarkTopic, type CorpusSource, type DetectorResult, type BenchmarkTestResult, type A2HTestCode,
} from './types'
import { getSourceById } from './corpus'
import { getTopic } from './topics'
import { getOutputById } from './outputs'
import { getBaseline, getPostScore } from './baseline'
import { getRun } from './runs'
import { getTestResult } from './testResults'

// The reusable document-detail record every later A2H test (A2H-04..17) will
// also want — one output, its source, its topic, and both of its GPTZero
// scores, joined from already-persisted rows so every field here is
// independently re-derivable from the underlying collections (§21). Phase 2
// adds `preservation` — the fixture-backed test results for this exact
// output, keyed by test code — on top of this same shape rather than
// replacing it (§36).
export interface OutputDetail {
  output: BenchmarkOutput
  source: CorpusSource
  topic: BenchmarkTopic
  baseline: DetectorResult | null
  postScore: DetectorResult | null
  preservation: Partial<Record<A2HTestCode, BenchmarkTestResult>>
}

export async function getOutputDetail(firestore: Firestore, runId: string, outputId: string): Promise<OutputDetail | null> {
  const output = await getOutputById(firestore, outputId)
  if (!output || output.runId !== runId) return null

  const [source, topic, run] = await Promise.all([
    getSourceById(firestore, output.sourceId),
    getTopic(firestore, output.topicId),
    getRun(firestore, runId),
  ])
  if (!source || !topic || !run) return null

  const detectorConfigId = run.detectorConfigId ?? DEFAULT_DETECTOR_CONFIG_ID
  const [baseline, postScore, preservationEntries] = await Promise.all([
    getBaseline(firestore, output.sourceId, detectorConfigId),
    getPostScore(firestore, output.id, detectorConfigId),
    Promise.all(FIXTURE_REQUIRING_TESTS.map(async code => [code, await getTestResult(firestore, runId, output.id, code, run.testVersion)] as const)),
  ])

  const preservation: Partial<Record<A2HTestCode, BenchmarkTestResult>> = {}
  for (const [code, result] of preservationEntries) if (result) preservation[code] = result

  return { output, source, topic, baseline, postScore, preservation }
}

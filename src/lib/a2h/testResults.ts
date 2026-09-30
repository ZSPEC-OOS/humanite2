import type { Firestore, Query, DocumentData } from 'firebase-admin/firestore'
import { A2H_COLLECTIONS, type A2HTestCode, type BenchmarkTestResult } from './types'

const COLLECTION = A2H_COLLECTIONS.testResults

// One generic table for every A2H-0N test's result row (§9) — the id is
// deterministic from (runId, outputId|fixtureId, benchmarkCode,
// testVersion), the same logical key test_evaluation/repair_evaluation
// jobs use, so writing "the same" result twice (a retried job, a resumed
// run) overwrites the identical row rather than duplicating it. Exactly
// one of outputId/fixtureId disambiguates a row: output-scoped tests
// (A2H-01/02/04/05/08/09/10/13) set outputId; fixture-scoped tests
// (A2H-06/A2H-12, Phase 3 — there is no BenchmarkOutput to key on) set
// fixtureId instead.
function testResultId(runId: string, outputId: string | null, fixtureId: string | null, benchmarkCode: A2HTestCode, testVersion: string): string {
  return `${runId}__${outputId ?? fixtureId ?? 'none'}__${benchmarkCode}__${testVersion}`
}

export async function upsertTestResult(firestore: Firestore, result: Omit<BenchmarkTestResult, 'id'>): Promise<BenchmarkTestResult> {
  const id = testResultId(result.runId, result.outputId, result.fixtureId, result.benchmarkCode, result.testVersion)
  const full: BenchmarkTestResult = { id, ...result }
  await firestore.collection(COLLECTION).doc(id).set(full)
  return full
}

export async function getTestResult(
  firestore: Firestore,
  runId: string,
  outputId: string | null,
  fixtureId: string | null,
  benchmarkCode: A2HTestCode,
  testVersion: string,
): Promise<BenchmarkTestResult | null> {
  const doc = await firestore.collection(COLLECTION).doc(testResultId(runId, outputId, fixtureId, benchmarkCode, testVersion)).get()
  return doc.exists ? (doc.data() as BenchmarkTestResult) : null
}

export async function listTestResultsForRun(firestore: Firestore, runId: string, benchmarkCode?: A2HTestCode): Promise<BenchmarkTestResult[]> {
  let query: Query<DocumentData> = firestore.collection(COLLECTION).where('runId', '==', runId)
  if (benchmarkCode) query = query.where('benchmarkCode', '==', benchmarkCode)
  const snap = await query.get()
  return snap.docs.map(d => d.data() as BenchmarkTestResult)
}

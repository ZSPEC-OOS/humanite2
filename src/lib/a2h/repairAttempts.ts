import type { Firestore, Query, DocumentData } from 'firebase-admin/firestore'
import { A2H_COLLECTIONS, type BenchmarkRepairAttempt } from './types'

const COLLECTION = A2H_COLLECTIONS.repairAttempts

// Deterministic identity per §23: run + fixture + benchmarkCode +
// repairConfigVersion — never intensity (A2H-06/A2H-12 use one fixed V1
// repair configuration, §24, not the source×intensity grid).
export function repairAttemptId(runId: string, fixtureId: string, benchmarkCode: 'A2H-06' | 'A2H-12', repairConfigVersion: string): string {
  return `${runId}__${fixtureId}__${benchmarkCode}__${repairConfigVersion}`
}

export async function getRepairAttempt(firestore: Firestore, id: string): Promise<BenchmarkRepairAttempt | null> {
  const doc = await firestore.collection(COLLECTION).doc(id).get()
  return doc.exists ? (doc.data() as BenchmarkRepairAttempt) : null
}

export async function listRepairAttemptsForRun(firestore: Firestore, runId: string, benchmarkCode?: 'A2H-06' | 'A2H-12'): Promise<BenchmarkRepairAttempt[]> {
  let query: Query<DocumentData> = firestore.collection(COLLECTION).where('runId', '==', runId)
  if (benchmarkCode) query = query.where('benchmarkCode', '==', benchmarkCode)
  const snap = await query.get()
  return snap.docs.map(d => d.data() as BenchmarkRepairAttempt)
}

export interface RepairCallResult {
  repairedOutput: string | null
  modelProvider: string
  model: string
  latencyMs: number
  modelCalls: number | null
  retryCount: number
  inputTokens: number | null
  outputTokens: number | null
  estimatedCostUsd: number | null
  status: 'success' | 'failed'
  errorCode: string | null
  errorMessage: string | null
}

export interface GetOrCreateRepairAttemptParams {
  runId: string
  corpusProjectId: string
  fixtureSetId: string
  fixtureId: string
  benchmarkCode: 'A2H-06' | 'A2H-12'
  sourceId: string
  corruptedInput: string
  repairConfigVersion: string
  repair: () => Promise<RepairCallResult>
}

// Idempotent get-or-create (§50): an existing SUCCESSFUL attempt for this
// exact identity is returned as-is, and `repair` — the one place a paid
// model call happens — is never invoked. This is what makes a resumed run,
// a retried job, or a duplicate API call safe from duplicating billable
// work. A FAILED attempt retries freely, the same policy outputs.ts's
// transformSource uses for a failed Humanize call.
//
// §51's audit-history fields (attemptNumber/supersedesAttemptId) are
// carried on every row, always 1/null via this path — an explicit
// "regenerate, keep the prior attempt" admin action is intentionally
// deferred (see the Phase 3 completion report); nothing here ever
// overwrites a SUCCESSFUL attempt's evidence.
export async function getOrCreateRepairAttempt(firestore: Firestore, params: GetOrCreateRepairAttemptParams): Promise<BenchmarkRepairAttempt> {
  const id = repairAttemptId(params.runId, params.fixtureId, params.benchmarkCode, params.repairConfigVersion)
  const existing = await getRepairAttempt(firestore, id)
  if (existing && existing.status === 'success') return existing

  const result = await params.repair()
  const attempt: BenchmarkRepairAttempt = {
    id,
    runId: params.runId,
    corpusProjectId: params.corpusProjectId,
    fixtureSetId: params.fixtureSetId,
    fixtureId: params.fixtureId,
    benchmarkCode: params.benchmarkCode,
    sourceId: params.sourceId,
    corruptedInput: params.corruptedInput,
    repairedOutput: result.repairedOutput,
    modelProvider: result.modelProvider,
    model: result.model,
    latencyMs: result.latencyMs,
    modelCalls: result.modelCalls,
    retryCount: result.retryCount,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    estimatedCostUsd: result.estimatedCostUsd,
    status: result.status,
    errorCode: result.errorCode,
    errorMessage: result.errorMessage,
    createdAt: new Date().toISOString(),
    attemptNumber: 1,
    supersedesAttemptId: null,
  }
  await firestore.collection(COLLECTION).doc(id).set(attempt)
  if (attempt.status === 'failed') throw new Error(attempt.errorMessage ?? 'Repair attempt failed.')
  return attempt
}

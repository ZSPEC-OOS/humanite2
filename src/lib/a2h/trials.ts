import type { Firestore, Query, DocumentData } from 'firebase-admin/firestore'
import { A2H_COLLECTIONS, type BenchmarkTrial, type BenchmarkExperimentalTestCode, type BenchmarkTrialStatus } from './types'
import type { DetectionClassification } from '@/lib/detection/contracts'

const COLLECTION = A2H_COLLECTIONS.trials

// Deterministic logical identity (§5, §36): run + benchmarkCode + source +
// condition + trial index. A job and the trial it produces always share this
// same id (see jobs.ts's experimentalTrialJobId), so re-enqueueing or
// re-running "the same" trial always resolves to the same document.
export function trialId(runId: string, benchmarkCode: BenchmarkExperimentalTestCode, sourceId: string, conditionId: string, trialIndex: number): string {
  return `${runId}__${benchmarkCode}__${sourceId}__${conditionId}__${trialIndex}`
}

export async function getTrial(firestore: Firestore, id: string): Promise<BenchmarkTrial | null> {
  const doc = await firestore.collection(COLLECTION).doc(id).get()
  return doc.exists ? (doc.data() as BenchmarkTrial) : null
}

export async function listTrialsForRun(firestore: Firestore, runId: string, benchmarkCode?: BenchmarkExperimentalTestCode): Promise<BenchmarkTrial[]> {
  let query: Query<DocumentData> = firestore.collection(COLLECTION).where('runId', '==', runId)
  if (benchmarkCode) query = query.where('benchmarkCode', '==', benchmarkCode)
  const snap = await query.get()
  return snap.docs.map(d => d.data() as BenchmarkTrial)
}

export async function listTrialsForSource(firestore: Firestore, runId: string, benchmarkCode: BenchmarkExperimentalTestCode, sourceId: string): Promise<BenchmarkTrial[]> {
  const snap = await firestore.collection(COLLECTION)
    .where('runId', '==', runId).where('benchmarkCode', '==', benchmarkCode).where('sourceId', '==', sourceId)
    .get()
  return snap.docs.map(d => d.data() as BenchmarkTrial)
}

export interface TrialRunResult {
  outputText: string | null
  outputSha256: string | null
  outputWords: number | null
  modelProvider: string
  model: string
  latencyMs: number | null
  modelCalls: number | null
  retryCount: number
  candidateCount: number | null
  inputTokens: number | null
  outputTokens: number | null
  estimatedCostUsd: number | null
  aiProbability: number | null
  humanProbability: number | null
  classification: DetectionClassification | null
  diagnostics: Record<string, unknown> | null
  status: BenchmarkTrialStatus
  errorCode: string | null
  errorMessage: string | null
}

export interface GetOrCreateTrialParams {
  runId: string
  corpusProjectId: string
  benchmarkCode: BenchmarkExperimentalTestCode
  sourceId: string
  conditionId: string
  trialIndex: number
  condition: Record<string, unknown>
  run: () => Promise<TrialRunResult>
}

// Idempotent the same way getOrCreateRepairAttempt is (§37, §51): an
// existing SUCCESSFUL trial is reused as-is, with zero new calls. A trial
// whose last attempt FAILED retries freely (no force needed) — the same
// resume-safe posture transformSource/getOrCreateRepairAttempt already use.
// Completed trial evidence is never overwritten by a resumed/retried run;
// only an explicit admin regeneration (not yet built — see the completion
// report's deferred items) would create a new attempt.
export async function getOrCreateTrial(firestore: Firestore, params: GetOrCreateTrialParams): Promise<BenchmarkTrial> {
  const id = trialId(params.runId, params.benchmarkCode, params.sourceId, params.conditionId, params.trialIndex)
  const ref = firestore.collection(COLLECTION).doc(id)
  const existing = await ref.get()
  if (existing.exists) {
    const trial = existing.data() as BenchmarkTrial
    if (trial.status === 'success') return trial
  }

  const now = new Date().toISOString()
  const result = await params.run()
  const trial: BenchmarkTrial = {
    id,
    runId: params.runId,
    corpusProjectId: params.corpusProjectId,
    benchmarkCode: params.benchmarkCode,
    sourceId: params.sourceId,
    trialIndex: params.trialIndex,
    conditionId: params.conditionId,
    condition: params.condition,
    outputText: result.outputText,
    outputSha256: result.outputSha256,
    outputWords: result.outputWords,
    modelProvider: result.modelProvider,
    model: result.model,
    latencyMs: result.latencyMs,
    modelCalls: result.modelCalls,
    retryCount: result.retryCount,
    candidateCount: result.candidateCount,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    estimatedCostUsd: result.estimatedCostUsd,
    aiProbability: result.aiProbability,
    humanProbability: result.humanProbability,
    classification: result.classification,
    diagnostics: result.diagnostics,
    status: result.status,
    errorCode: result.errorCode,
    errorMessage: result.errorMessage,
    createdAt: now,
    completedAt: now,
  }
  await ref.set(trial)
  if (trial.status === 'failed') throw new Error(trial.errorMessage ?? 'Experimental trial failed.')
  return trial
}

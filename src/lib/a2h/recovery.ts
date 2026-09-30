import type { Firestore } from 'firebase-admin/firestore'
import { A2H_COLLECTIONS, DEFAULT_DETECTOR_CONFIG_ID, EXPERIMENTAL_TRIAL_TEST_CODES, type BenchmarkRun, type BenchmarkJob, type BenchmarkExperimentalTestCode } from './types'
import { isJobStale, markJobCompleted, resetJobForRetry, ensureTransformJobsForSource, ensurePostScoreJobForOutput, ensureTestEvaluationJobsForOutput } from './jobs'
import { getSourceById } from './corpus'
import { getBaseline, getPostScore } from './baseline'
import { getOutput, getOutputById } from './outputs'
import { getTestResult, upsertTestResult } from './testResults'
import { getFixture } from './fixtures'
import { getRepairAttempt, repairAttemptId } from './repairAttempts'
import { getTrial, trialId } from './trials'
import { classifyGrammarRepair, A2H06_CODE, type GrammarRepairFixtureExpected, type GrammarRepairFixtureResult } from './a2h06'
import { classifyFactualRepair, A2H12_CODE, type FactualRepairFixtureExpected, type FactualRepairFixtureResult } from './a2h12'

// Phase 5A: the first-class recovery/reconciliation layer (§§10-19, 44-46 of
// the spec). Every artifact-producing entry point this benchmark already
// calls (transformSource, acquireBaseline/acquirePostScore,
// getOrCreateRepairAttempt, getOrCreateTrial) is ALREADY idempotent —
// check-existing-first, never re-paying for a successful result — so a
// stale job could technically just be reset to 'queued' and safely
// re-executed. This module exists anyway, deliberately, because the spec
// explicitly requires it (§10: "do not blindly set every stale job back to
// queued") and because checking first is strictly better: it avoids a
// wasted claim/execute round-trip when we already know the answer, it
// repairs the workflow graph (creates missing downstream jobs — §46)
// without waiting for the stale job to be re-run, and it produces the
// accurate recovery counts (§18) the admin UI reports after Resume.

export type ReconcileOutcome = 'completed' | 'requeued' | 'unresolved'

// §11: a stale baseline_gptzero job — does the immutable baseline already
// exist? If so, ensure this source's humanite_transform jobs exist (the
// workflow-graph repair a bare status flip would miss) and mark completed.
// Never calls GPTZero merely to check.
async function reconcileBaselineJob(firestore: Firestore, run: BenchmarkRun, job: BenchmarkJob): Promise<ReconcileOutcome> {
  const source = await getSourceById(firestore, job.sourceId)
  if (!source) return 'unresolved'
  const detectorConfigId = run.detectorConfigId ?? DEFAULT_DETECTOR_CONFIG_ID
  const baseline = await getBaseline(firestore, job.sourceId, detectorConfigId)
  const valid = baseline != null && baseline.sourceId === job.sourceId && baseline.detectorConfigId === detectorConfigId
    && baseline.stage === 'baseline' && baseline.classification != null
  if (!valid) return 'requeued'
  await ensureTransformJobsForSource(firestore, run, job.sourceId)
  return 'completed'
}

// §12: a stale humanite_transform job — does a SUCCESSFUL output already
// exist for this exact (run, source, intensity)? A FAILED or missing output
// means the paid call may genuinely need to run (again) — see §43's
// documented limit on this guarantee. Never overwrites a successful output.
async function reconcileTransformJob(firestore: Firestore, run: BenchmarkRun, job: BenchmarkJob): Promise<ReconcileOutcome> {
  if (job.intensity == null) return 'unresolved'
  const output = await getOutput(firestore, run.id, job.sourceId, job.intensity)
  const valid = output != null && output.status === 'success' && output.outputText.length > 0 && output.outputSha256.length > 0
    && output.runId === run.id && output.sourceId === job.sourceId && output.intensity === job.intensity
  if (!valid) return 'requeued'
  const detectorConfigId = run.detectorConfigId ?? DEFAULT_DETECTOR_CONFIG_ID
  await ensurePostScoreJobForOutput(firestore, run, output, detectorConfigId)
  return 'completed'
}

// §13: a stale post_gptzero job — does the post-transform DetectorResult
// already exist for this output? If so, ensure the test_evaluation jobs it
// unblocks exist too. Never calls GPTZero merely to check.
async function reconcilePostScoreJob(firestore: Firestore, run: BenchmarkRun, job: BenchmarkJob): Promise<ReconcileOutcome> {
  if (!job.outputId) return 'unresolved'
  const output = await getOutputById(firestore, job.outputId)
  if (!output) return 'unresolved'
  const detectorConfigId = run.detectorConfigId ?? DEFAULT_DETECTOR_CONFIG_ID
  const postScore = await getPostScore(firestore, job.outputId, detectorConfigId)
  const valid = postScore != null && postScore.outputId === job.outputId && postScore.stage === 'post_transform' && postScore.detectorConfigId === detectorConfigId
  if (!valid) return 'requeued'
  await ensureTestEvaluationJobsForOutput(firestore, run, output)
  return 'completed'
}

// §14: deterministic evaluations are local/non-paid — always safe to
// requeue when the expected result is missing, no special care needed.
async function reconcileTestEvaluationJob(firestore: Firestore, run: BenchmarkRun, job: BenchmarkJob): Promise<ReconcileOutcome> {
  if (!job.outputId || !job.benchmarkCode) return 'unresolved'
  const result = await getTestResult(firestore, run.id, job.outputId, null, job.benchmarkCode, run.testVersion)
  const valid = result != null && result.runId === run.id && result.outputId === job.outputId
    && result.benchmarkCode === job.benchmarkCode && result.testVersion === run.testVersion
  return valid ? 'completed' : 'requeued'
}

// §15: a stale repair_evaluation job — does a SUCCESSFUL BenchmarkRepairAttempt
// already exist? If so but its BenchmarkTestResult is missing (the process
// died between the two writes), reuse the already-paid repair output to
// recompute the local classification — never a second repair model call.
async function reconcileRepairJob(firestore: Firestore, run: BenchmarkRun, job: BenchmarkJob): Promise<ReconcileOutcome> {
  if (!job.fixtureId || (job.benchmarkCode !== A2H06_CODE && job.benchmarkCode !== A2H12_CODE)) return 'unresolved'
  const benchmarkCode = job.benchmarkCode
  const attempt = await getRepairAttempt(firestore, repairAttemptId(run.id, job.fixtureId, benchmarkCode, run.repairConfigVersion))
  if (!attempt || attempt.status !== 'success') return 'requeued'

  const existingResult = await getTestResult(firestore, run.id, null, job.fixtureId, benchmarkCode, run.testVersion)
  if (!existingResult) {
    const fixture = await getFixture(firestore, job.fixtureId)
    if (!fixture) return 'unresolved'
    const now = new Date().toISOString()
    if (benchmarkCode === A2H06_CODE) {
      const expected = fixture.expected as unknown as GrammarRepairFixtureExpected
      const { status, targetErrorCorrected, newErrorIntroduced } = classifyGrammarRepair(expected, attempt.repairedOutput)
      const result: GrammarRepairFixtureResult = {
        fixtureId: fixture.id, category: expected.category, status, targetErrorCorrected, newErrorIntroduced,
        repairAttemptId: attempt.id, repairedText: attempt.repairedOutput,
      }
      await upsertTestResult(firestore, {
        runId: run.id, corpusProjectId: run.corpusProjectId, sourceId: fixture.sourceId, outputId: null, fixtureId: fixture.id,
        benchmarkCode: A2H06_CODE, testVersion: run.testVersion, passed: null, score: status === 'corrected' ? 1 : 0,
        measurements: result as unknown as Record<string, unknown>, evaluatedAt: now,
      })
    } else {
      const expected = fixture.expected as unknown as FactualRepairFixtureExpected
      const { status, presentGroundTruth, presentCorrupted } = classifyFactualRepair(expected, attempt.repairedOutput)
      const result: FactualRepairFixtureResult = {
        fixtureId: fixture.id, category: expected.category, status, presentGroundTruth, presentCorrupted,
        repairAttemptId: attempt.id, repairedText: attempt.repairedOutput,
      }
      await upsertTestResult(firestore, {
        runId: run.id, corpusProjectId: run.corpusProjectId, sourceId: fixture.sourceId, outputId: null, fixtureId: fixture.id,
        benchmarkCode: A2H12_CODE, testVersion: run.testVersion, passed: null, score: status === 'fully_repaired' ? 1 : 0,
        measurements: result as unknown as Record<string, unknown>, evaluatedAt: now,
      })
    }
  }
  return 'completed'
}

// §16: a stale experimental_trial job — the job and the trial it produces
// share the same LOGICAL identity (run, benchmarkCode, source, condition,
// trial index — see jobs.ts's experimentalTrialJobId/trials.ts's trialId),
// but NOT the same literal Firestore document id (the job id carries an
// extra stage prefix), so the trial's own id must be recomputed from the
// job's logical fields rather than reused directly. Every A2H-07/11/14/15
// report is computed live from BenchmarkTrial rows — there is no separate
// downstream artifact to repair.
async function reconcileExperimentalTrialJob(firestore: Firestore, run: BenchmarkRun, job: BenchmarkJob): Promise<ReconcileOutcome> {
  if (!job.benchmarkCode || !EXPERIMENTAL_TRIAL_TEST_CODES.includes(job.benchmarkCode) || !job.conditionId || job.trialIndex == null) return 'unresolved'
  const benchmarkCode = job.benchmarkCode as BenchmarkExperimentalTestCode
  const trial = await getTrial(firestore, trialId(run.id, benchmarkCode, job.sourceId, job.conditionId, job.trialIndex))
  const valid = trial != null && trial.status === 'success' && trial.runId === run.id
  return valid ? 'completed' : 'requeued'
}

// §45: one dispatcher, one function per stage — never a giant nested
// function in runs.ts.
export async function reconcileJob(firestore: Firestore, run: BenchmarkRun, job: BenchmarkJob): Promise<ReconcileOutcome> {
  switch (job.stage) {
    case 'baseline_gptzero': return reconcileBaselineJob(firestore, run, job)
    case 'humanite_transform': return reconcileTransformJob(firestore, run, job)
    case 'post_gptzero': return reconcilePostScoreJob(firestore, run, job)
    case 'test_evaluation': return reconcileTestEvaluationJob(firestore, run, job)
    case 'repair_evaluation': return reconcileRepairJob(firestore, run, job)
    case 'experimental_trial': return reconcileExperimentalTrialJob(firestore, run, job)
  }
}

// Transactionally re-verifies the job is STILL 'running' and STILL stale
// immediately before applying the reconciliation outcome — guards against a
// race where the job's original worker (not actually dead, just slow)
// legitimately finishes it between when recoverStaleJobs listed it and now.
// Returns false (and applies nothing) when that race is detected.
async function applyReconciliation(firestore: Firestore, jobId: string, outcome: ReconcileOutcome): Promise<boolean> {
  const ref = firestore.collection(A2H_COLLECTIONS.jobs).doc(jobId)
  return firestore.runTransaction(async tx => {
    const snap = await tx.get(ref)
    if (!snap.exists) return false
    const job = snap.data() as BenchmarkJob
    if (!isJobStale(job, Date.now())) return false
    const now = new Date().toISOString()
    if (outcome === 'completed') {
      tx.set(ref, {
        ...job, status: 'completed', completedAt: now, errorCode: null, errorMessage: null,
        leaseOwner: null, leaseAcquiredAt: null, leaseExpiresAt: null, failureClass: null,
      })
    } else if (outcome === 'requeued') {
      tx.set(ref, { ...job, status: 'queued', leaseOwner: null, leaseAcquiredAt: null, leaseExpiresAt: null, nextAttemptAt: null })
    } else {
      tx.set(ref, {
        ...job, status: 'failed',
        errorCode: 'UNRESOLVED_STALE_JOB',
        errorMessage: "Recovery could not determine this job's expected artifact — its logical identity is incomplete or a record it depends on no longer exists.",
        failureClass: 'permanent', leaseOwner: null, leaseAcquiredAt: null, leaseExpiresAt: null,
      })
    }
    return true
  })
}

export interface RecoverySummary {
  staleJobsFound: number
  reconciledCompleted: number
  requeued: number
  unresolved: number
}

// §10/§18's first-class recovery entry point — never blindly resets a stale
// 'running' job back to 'queued'; always checks whether its expected
// artifact already exists (and is internally consistent) first. Idempotent
// (§17): every job this call touches leaves 'running' entirely, so a second
// call back-to-back finds nothing left to reconcile and returns all zeros.
export async function recoverStaleJobs(firestore: Firestore, run: BenchmarkRun): Promise<RecoverySummary> {
  const snap = await firestore.collection(A2H_COLLECTIONS.jobs).where('runId', '==', run.id).where('status', '==', 'running').get()
  const running = snap.docs.map(d => d.data() as BenchmarkJob)
  const now = Date.now()
  const stale = running.filter(j => isJobStale(j, now))

  let reconciledCompleted = 0
  let requeued = 0
  let unresolved = 0
  for (const job of stale) {
    const outcome = await reconcileJob(firestore, run, job)
    const applied = await applyReconciliation(firestore, job.id, outcome)
    if (!applied) continue // the job's real worker finished it in the meantime — it was never actually stale
    if (outcome === 'completed') reconciledCompleted++
    else if (outcome === 'requeued') requeued++
    else unresolved++
  }
  return { staleJobsFound: stale.length, reconciledCompleted, requeued, unresolved }
}

// §32: the reconciliation-aware half of the admin's "Retry Failed Jobs"
// action — a FAILED job's expected artifact may already exist (a concurrent
// tab, a partial success recorded just before the error), so this checks
// before ever resetting a failed job back to 'queued'. A genuinely
// 'unresolved' job (its logical identity is broken — a deleted fixture, a
// misconfigured run) is deliberately left 'failed' rather than requeued
// forever; an admin needs to look at it, not have it spin.
export async function reconcileAndRetryFailedJobs(firestore: Firestore, run: BenchmarkRun): Promise<{ retriedCount: number; reconciledCount: number }> {
  const snap = await firestore.collection(A2H_COLLECTIONS.jobs).where('runId', '==', run.id).where('status', '==', 'failed').get()
  const failed = snap.docs.map(d => d.data() as BenchmarkJob)

  let retriedCount = 0
  let reconciledCount = 0
  for (const job of failed) {
    const outcome = await reconcileJob(firestore, run, job)
    if (outcome === 'completed') {
      await markJobCompleted(firestore, job.id)
      reconciledCount++
    } else if (outcome === 'requeued') {
      await resetJobForRetry(firestore, job.id)
      retriedCount++
    }
    // 'unresolved' — leave the job 'failed'; not counted as retried.
  }
  return { retriedCount, reconciledCount }
}

import type { Firestore } from 'firebase-admin/firestore'
import type OpenAI from 'openai'
import {
  DEFAULT_DETECTOR_CONFIG_ID, FIXTURE_TYPE_FOR_TEST,
  type BenchmarkRun, type BenchmarkJob, type BenchmarkJobStage, type BenchmarkFixture,
} from './types'
import { getRun, maybeCompleteRun } from './runs'
import {
  getOrCreateJob, claimJob, reclaimStaleJobs, markJobCompleted, markJobFailed, listJobsByStageAndStatus, listDueRetryJobs,
  transformJobId, postScoreJobId, testEvaluationJobId,
} from './jobs'
import { getSourceById } from './corpus'
import { acquireBaseline, acquirePostScore, getBaseline, getPostScore } from './baseline'
import { getOutputById, transformSource } from './outputs'
import { computeA2H01Measurements, A2H01_CODE } from './a2h01'
import { computeA2H02Measurements, A2H02_CODE } from './a2h02'
import { DETERMINISTIC_EVALUATORS } from './deterministicEvaluators'
import { listFixturesForSource, getFixture } from './fixtures'
import { getOrCreateRepairAttempt } from './repairAttempts'
import { repairGrammar, repairChunk } from '@/lib/evaluation/repair'
import { classifyGrammarRepair, A2H06_CODE, type GrammarRepairFixtureExpected, type GrammarRepairFixtureResult } from './a2h06'
import { classifyFactualRepair, A2H12_CODE, type FactualRepairFixtureExpected, type FactualRepairFixtureResult } from './a2h12'
import { upsertTestResult } from './testResults'
import { runA2H07Trial, A2H07_CODE } from './a2h07'
import { runA2H11Trial, A2H11_CODE } from './a2h11'
import { runA2H14Trial, A2H14_CODE } from './a2h14'
import { runA2H15Trial, A2H15_CODE } from './a2h15'

// V1's one fixed repair configuration (§24) — tone is held constant, the
// same posture outputs.ts's FIXED_TONE uses for the ordinary Humanite
// pipeline, since repair configuration is a run-snapshotted constant, not a
// per-fixture choice.
const REPAIR_TONE = 'balanced'

export interface ExecuteBatchOptions {
  client: OpenAI
  model: string
  modelProvider: string
  gptZeroApiKey: string
  maxJobsPerStage?: number
  // Identifies which worker invocation is doing this batch — an interactive
  // browser call or a cron tick — recorded on each job's leaseOwner so a
  // stuck lease can be traced back to what claimed it. Callers that don't
  // care (existing tests, the interactive route) get a reasonable default.
  workerId?: string
}

export interface ExecuteBatchResult {
  processed: number
  stage: BenchmarkJobStage | 'idle'
  run: BenchmarkRun
}

const DEFAULT_MAX_JOBS_PER_STAGE = 5
// 'repair_evaluation' (A2H-06/A2H-12) has no dependency on the earlier
// stages — it operates on fixtures, not outputs — but is still drained in
// its own turn per call, after any humanite/post-score/test-evaluation work
// still queued, rather than interleaved with it.
// 'experimental_trial' (A2H-07/11/14/15, Phase 4) likewise has no dependency
// on the earlier stages — it operates on the source directly, producing its
// own BenchmarkTrial evidence rather than scoring an existing output.
const STAGE_ORDER: readonly BenchmarkJobStage[] = ['baseline_gptzero', 'humanite_transform', 'post_gptzero', 'test_evaluation', 'repair_evaluation', 'experimental_trial']

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size))
  return chunks
}

// Processes one bounded batch of a run's ready work and returns immediately.
// Phase 5: this is now WORKER-COMPATIBLE processing logic — both the
// interactive "Run All" browser loop and the cron worker (see
// /api/cron/a2h-worker) call this exact function, and both go through the
// same claimJob() transaction, so they can safely run concurrently without
// ever double-processing (or double-paying for) the same job. A call
// against a paused/cancelled/completed/needs_attention run is a safe no-op
// (§11: pause must not start additional queued work).
//
// Stages are drained in dependency order within one call: a later stage's
// jobs don't exist until the earlier stage that creates them (see below)
// has completed jobs to react to, so this only ever processes one stage per
// call — exactly the stage with work ready right now. "Ready" now means
// queued OR a due retry (nextAttemptAt has passed) — see listDueRetryJobs.
// Jobs within a batch run with up to run.concurrency in flight at once via
// Promise.all chunks.
export async function executeRunBatch(firestore: Firestore, runId: string, options: ExecuteBatchOptions): Promise<ExecuteBatchResult> {
  const run = await getRun(firestore, runId)
  if (!run) throw new Error('Benchmark run not found.')
  if (run.status !== 'running') {
    return { processed: 0, stage: 'idle', run }
  }

  // Reclaim any 'running' job whose lease expired before its worker
  // finished (a crash, a timeout, a killed request) — a maintenance sweep
  // once per tick, not part of the per-job claim path.
  await reclaimStaleJobs(firestore, runId)

  const maxJobs = options.maxJobsPerStage ?? DEFAULT_MAX_JOBS_PER_STAGE
  const workerId = options.workerId ?? `interactive-${Date.now()}`
  const detectorConfigId = run.detectorConfigId ?? DEFAULT_DETECTOR_CONFIG_ID
  // One fixture query per source, shared across every test_evaluation job
  // this call processes (§48) — several deterministic tests (A2H-04/05/09/
  // 10/13) against the same source, and repeated intensities of the same
  // source, all resolve to the same cached read instead of one Firestore
  // query per output per test.
  const fixtureCache = new Map<string, Promise<BenchmarkFixture[]>>()

  for (const stage of STAGE_ORDER) {
    const [queued, dueRetries] = await Promise.all([
      listJobsByStageAndStatus(firestore, runId, stage, 'queued'),
      listDueRetryJobs(firestore, runId, stage),
    ])
    const ready = [...queued, ...dueRetries]
    if (ready.length === 0) continue

    const batch = ready.slice(0, maxJobs)
    let processed = 0
    for (const chunk of chunkArray(batch, Math.max(1, run.concurrency))) {
      await Promise.all(chunk.map(job => processJob(firestore, run, job, detectorConfigId, options, fixtureCache, workerId)))
      processed += chunk.length
    }
    await maybeCompleteRun(firestore, runId)
    return { processed, stage, run }
  }

  const completed = await maybeCompleteRun(firestore, runId)
  return { processed: 0, stage: 'idle', run: completed ?? run }
}

async function processJob(
  firestore: Firestore,
  run: BenchmarkRun,
  job: BenchmarkJob,
  detectorConfigId: string,
  options: ExecuteBatchOptions,
  fixtureCache: Map<string, Promise<BenchmarkFixture[]>>,
  workerId: string,
): Promise<void> {
  const claimed = await claimJob(firestore, job.id, workerId)
  // Another worker already claimed this job (or its lease hadn't actually
  // expired yet) between when we listed it and now — an expected race, not
  // an error, so this attempt simply skips it.
  if (!claimed) return
  try {
    if (job.stage === 'baseline_gptzero') {
      await runBaselineJob(firestore, run, job, detectorConfigId, options)
    } else if (job.stage === 'humanite_transform') {
      await runTransformJob(firestore, run, job, detectorConfigId, options)
    } else if (job.stage === 'post_gptzero') {
      await runPostScoreJob(firestore, run, job, detectorConfigId, options)
    } else if (job.stage === 'test_evaluation') {
      await runTestEvaluationJob(firestore, run, job, detectorConfigId, fixtureCache)
    } else if (job.stage === 'repair_evaluation') {
      await runRepairEvaluationJob(firestore, run, job, options)
    } else if (job.stage === 'experimental_trial') {
      await runExperimentalTrialJob(firestore, run, job, options)
    }
    await markJobCompleted(firestore, job.id)
  } catch (err) {
    await markJobFailed(firestore, job.id, err)
  }
}

// Acquires (or reuses, cross-run — see baseline.ts) the source's baseline,
// then enqueues this run's own humanite_transform job for every selected
// intensity — the point in the pipeline where per-intensity work first
// exists to queue.
async function runBaselineJob(
  firestore: Firestore,
  run: BenchmarkRun,
  job: BenchmarkJob,
  detectorConfigId: string,
  options: ExecuteBatchOptions,
): Promise<void> {
  const source = await getSourceById(firestore, job.sourceId)
  if (!source) throw new Error(`Source ${job.sourceId} not found.`)

  await acquireBaseline(firestore, { source, runId: run.id, detectorConfigId, apiKey: options.gptZeroApiKey })

  await Promise.all(run.intensities.map(intensity => getOrCreateJob(firestore, {
    id: transformJobId(run.id, job.sourceId, intensity),
    runId: run.id,
    corpusProjectId: run.corpusProjectId,
    stage: 'humanite_transform',
    sourceId: job.sourceId,
    intensity,
  })))
}

// Runs the real Humanize pipeline at this job's intensity, then enqueues
// this output's post_gptzero job.
async function runTransformJob(
  firestore: Firestore,
  run: BenchmarkRun,
  job: BenchmarkJob,
  detectorConfigId: string,
  options: ExecuteBatchOptions,
): Promise<void> {
  if (job.intensity == null) throw new Error(`Transform job ${job.id} has no intensity.`)
  const source = await getSourceById(firestore, job.sourceId)
  if (!source) throw new Error(`Source ${job.sourceId} not found.`)

  const output = await transformSource(firestore, {
    runId: run.id,
    source,
    intensity: job.intensity,
    client: options.client,
    model: options.model,
    modelProvider: options.modelProvider,
    releasedAt: run.releasedAt,
  })

  await getOrCreateJob(firestore, {
    id: postScoreJobId(run.id, output.id, detectorConfigId),
    runId: run.id,
    corpusProjectId: run.corpusProjectId,
    stage: 'post_gptzero',
    sourceId: job.sourceId,
    outputId: output.id,
  })
}

// Scores the transformed output, then enqueues a test_evaluation job for
// every enabled test that consumes an output directly (A2H-01, A2H-02, and
// every fixture-backed deterministic test — A2H-04/05/09/10/13). A2H-03
// never gets a job — it's a pure aggregation of A2H-01/A2H-02 results (see
// a2h03.ts), computed on demand by the results API, never queued.
//
// The deterministic tests don't need this score to compute their own
// metric, but they still queue behind it (§7: "can still execute after
// output generation/post-score within the existing stage order") — this is
// the one fixed pipeline, never a second one, so post-score isn't
// special-cased away just because a given run's enabled tests don't happen
// to read it.
async function runPostScoreJob(
  firestore: Firestore,
  run: BenchmarkRun,
  job: BenchmarkJob,
  detectorConfigId: string,
  options: ExecuteBatchOptions,
): Promise<void> {
  if (!job.outputId) throw new Error(`Post-score job ${job.id} has no outputId.`)
  const output = await getOutputById(firestore, job.outputId)
  if (!output) throw new Error(`Output ${job.outputId} not found.`)

  await acquirePostScore(firestore, { output, detectorConfigId, apiKey: options.gptZeroApiKey })

  const evaluableTests = run.enabledTests.filter(t => t === A2H01_CODE || t === A2H02_CODE || t in DETERMINISTIC_EVALUATORS)
  await Promise.all(evaluableTests.map(code => getOrCreateJob(firestore, {
    id: testEvaluationJobId(run.id, output.id, code, run.testVersion),
    runId: run.id,
    corpusProjectId: run.corpusProjectId,
    stage: 'test_evaluation',
    sourceId: job.sourceId,
    outputId: output.id,
    benchmarkCode: code,
  })))
}

function getCachedFixtures(
  firestore: Firestore,
  fixtureCache: Map<string, Promise<BenchmarkFixture[]>>,
  fixtureSetId: string,
  sourceId: string,
): Promise<BenchmarkFixture[]> {
  const key = `${fixtureSetId}__${sourceId}`
  let cached = fixtureCache.get(key)
  if (!cached) {
    cached = listFixturesForSource(firestore, fixtureSetId, sourceId)
    fixtureCache.set(key, cached)
  }
  return cached
}

async function runTestEvaluationJob(
  firestore: Firestore,
  run: BenchmarkRun,
  job: BenchmarkJob,
  detectorConfigId: string,
  fixtureCache: Map<string, Promise<BenchmarkFixture[]>>,
): Promise<void> {
  if (!job.outputId || !job.benchmarkCode) throw new Error(`Test evaluation job ${job.id} is missing outputId/benchmarkCode.`)
  const output = await getOutputById(firestore, job.outputId)
  if (!output) throw new Error(`Output ${job.outputId} not found.`)

  const now = new Date().toISOString()

  // Fixture-backed deterministic tests (§28) never touch GPTZero — they
  // don't need postScore at all, unlike A2H-01/02 below.
  const evaluator = DETERMINISTIC_EVALUATORS[job.benchmarkCode]
  if (evaluator) {
    const source = await getSourceById(firestore, output.sourceId)
    if (!source) throw new Error(`Source ${output.sourceId} not found.`)
    // A2H-08 has no fixture type at all (§27/§47) — it scores the ordinary
    // output directly, so it gets an empty fixtures array rather than
    // requiring a fixture set like the other deterministic tests.
    const fixtureType = FIXTURE_TYPE_FOR_TEST[job.benchmarkCode]
    let fixtures: BenchmarkFixture[] = []
    if (fixtureType) {
      if (!run.fixtureSetId) throw new Error(`Run ${run.id} has no fixtureSetId but enables fixture-backed test ${job.benchmarkCode}.`)
      fixtures = await getCachedFixtures(firestore, fixtureCache, run.fixtureSetId, output.sourceId)
    }
    const evaluation = evaluator({ run, source, output, fixtures })
    await upsertTestResult(firestore, {
      runId: run.id,
      corpusProjectId: run.corpusProjectId,
      sourceId: output.sourceId,
      outputId: output.id,
      fixtureId: null,
      benchmarkCode: job.benchmarkCode,
      testVersion: run.testVersion,
      passed: evaluation.passed,
      score: evaluation.score,
      measurements: evaluation.measurements,
      evaluatedAt: now,
    })
    return
  }

  const postScore = await getPostScore(firestore, output.id, detectorConfigId)
  if (!postScore) throw new Error(`Post-transform score for output ${output.id} not found.`)

  if (job.benchmarkCode === A2H01_CODE) {
    const baseline = await getBaseline(firestore, output.sourceId, detectorConfigId)
    if (!baseline) throw new Error(`Baseline for source ${output.sourceId} not found.`)
    const measurements = computeA2H01Measurements(baseline, postScore)
    await upsertTestResult(firestore, {
      runId: run.id,
      corpusProjectId: run.corpusProjectId,
      sourceId: output.sourceId,
      outputId: output.id,
      fixtureId: null,
      benchmarkCode: A2H01_CODE,
      testVersion: run.testVersion,
      passed: measurements.convertedAiToHuman,
      score: measurements.deltaAiProbability,
      measurements: measurements as unknown as Record<string, unknown>,
      evaluatedAt: now,
    })
    return
  }

  if (job.benchmarkCode === A2H02_CODE) {
    const source = await getSourceById(firestore, output.sourceId)
    if (!source) throw new Error(`Source ${output.sourceId} not found.`)
    const measurements = computeA2H02Measurements(source, output, postScore)
    await upsertTestResult(firestore, {
      runId: run.id,
      corpusProjectId: run.corpusProjectId,
      sourceId: output.sourceId,
      outputId: output.id,
      fixtureId: null,
      benchmarkCode: A2H02_CODE,
      testVersion: run.testVersion,
      passed: null,
      score: measurements.transformationMagnitude,
      measurements: measurements as unknown as Record<string, unknown>,
      evaluatedAt: now,
    })
    return
  }

  throw new Error(`Test evaluation for ${job.benchmarkCode} is not implemented.`)
}

// A2H-06/A2H-12 (§21-26): unlike every other job stage, this one makes a
// targeted, paid repair call against a controlled derivative FIXTURE, not
// an ordinary source×intensity output. getOrCreateRepairAttempt (§50) is
// what makes this idempotent — a resumed run or a retried job reuses the
// already-persisted attempt instead of paying for the repair call again.
async function runRepairEvaluationJob(
  firestore: Firestore,
  run: BenchmarkRun,
  job: BenchmarkJob,
  options: ExecuteBatchOptions,
): Promise<void> {
  if (!job.fixtureId || !job.benchmarkCode) throw new Error(`Repair evaluation job ${job.id} is missing fixtureId/benchmarkCode.`)
  if (!run.fixtureSetId) throw new Error(`Run ${run.id} has no fixtureSetId but has a queued repair_evaluation job.`)
  const fixture = await getFixture(firestore, job.fixtureId)
  if (!fixture) throw new Error(`Fixture ${job.fixtureId} not found.`)
  const source = await getSourceById(firestore, fixture.sourceId)
  if (!source) throw new Error(`Source ${fixture.sourceId} not found.`)

  const now = new Date().toISOString()
  const fixtureSetId = run.fixtureSetId

  if (job.benchmarkCode === A2H06_CODE) {
    const expected = fixture.expected as unknown as GrammarRepairFixtureExpected
    const attempt = await getOrCreateRepairAttempt(firestore, {
      runId: run.id, corpusProjectId: run.corpusProjectId, fixtureSetId, fixtureId: fixture.id,
      benchmarkCode: A2H06_CODE, sourceId: fixture.sourceId, corruptedInput: expected.corruptedText,
      repairConfigVersion: run.repairConfigVersion,
      repair: async () => {
        const start = Date.now()
        try {
          const result = await repairGrammar(options.client, options.model, expected.corruptedText)
          return {
            repairedOutput: result.text, modelProvider: options.modelProvider, model: options.model, latencyMs: Date.now() - start,
            modelCalls: 1, retryCount: 0, inputTokens: result.inputTokens, outputTokens: result.outputTokens, estimatedCostUsd: null,
            status: 'success', errorCode: null, errorMessage: null,
          }
        } catch (err) {
          return {
            repairedOutput: null, modelProvider: options.modelProvider, model: options.model, latencyMs: Date.now() - start,
            modelCalls: 1, retryCount: 0, inputTokens: null, outputTokens: null, estimatedCostUsd: null,
            status: 'failed', errorCode: err instanceof Error ? err.constructor.name : 'UnknownError',
            errorMessage: err instanceof Error ? err.message : 'Grammar repair failed.',
          }
        }
      },
    })
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
    return
  }

  if (job.benchmarkCode === A2H12_CODE) {
    const expected = fixture.expected as unknown as FactualRepairFixtureExpected
    const attempt = await getOrCreateRepairAttempt(firestore, {
      runId: run.id, corpusProjectId: run.corpusProjectId, fixtureSetId, fixtureId: fixture.id,
      benchmarkCode: A2H12_CODE, sourceId: fixture.sourceId, corruptedInput: expected.corruptedText,
      repairConfigVersion: run.repairConfigVersion,
      repair: async () => {
        const start = Date.now()
        try {
          // repairChunk is the SAME fact-ledger-gated targeted repair the
          // production Humanize pipeline already uses (§21) — cleanText is
          // the ground truth, corruptedText is the (wrong) "output" it
          // verifies/repairs against.
          const repairResult = await repairChunk(options.client, options.model, expected.cleanText, expected.corruptedText, REPAIR_TONE, source.domainId)
          return {
            repairedOutput: repairResult.text, modelProvider: options.modelProvider, model: options.model, latencyMs: Date.now() - start,
            modelCalls: repairResult.modelCalls, retryCount: 0, inputTokens: repairResult.inputTokens, outputTokens: repairResult.outputTokens, estimatedCostUsd: null,
            status: 'success', errorCode: null, errorMessage: null,
          }
        } catch (err) {
          return {
            repairedOutput: null, modelProvider: options.modelProvider, model: options.model, latencyMs: Date.now() - start,
            modelCalls: 0, retryCount: 0, inputTokens: null, outputTokens: null, estimatedCostUsd: null,
            status: 'failed', errorCode: err instanceof Error ? err.constructor.name : 'UnknownError',
            errorMessage: err instanceof Error ? err.message : 'Factual repair failed.',
          }
        }
      },
    })
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
    return
  }

  throw new Error(`Repair evaluation for ${job.benchmarkCode} is not implemented.`)
}

// A2H-07/11/14/15 (Phase 4, §36): dispatches to each test's own trial runner,
// which persists a BenchmarkTrial via getOrCreateTrial's idempotency guard —
// a resumed run never re-pays for a completed trial. Unlike every other job
// stage, this one never writes a BenchmarkTestResult directly: the raw
// BenchmarkTrial rows themselves ARE the evidence each test's report query
// reads and aggregates on demand (the same "raw result records" role
// BenchmarkTestResult plays for the other tests).
async function runExperimentalTrialJob(
  firestore: Firestore,
  run: BenchmarkRun,
  job: BenchmarkJob,
  options: ExecuteBatchOptions,
): Promise<void> {
  if (!job.benchmarkCode) throw new Error(`Experimental trial job ${job.id} is missing benchmarkCode.`)
  const source = await getSourceById(firestore, job.sourceId)
  if (!source) throw new Error(`Source ${job.sourceId} not found.`)

  if (job.benchmarkCode === A2H07_CODE) {
    await runA2H07Trial(firestore, run, source, job, { client: options.client, model: options.model, modelProvider: options.modelProvider, gptZeroApiKey: options.gptZeroApiKey })
    return
  }
  if (job.benchmarkCode === A2H11_CODE) {
    await runA2H11Trial(firestore, run, source, job, { client: options.client, model: options.model, modelProvider: options.modelProvider })
    return
  }
  if (job.benchmarkCode === A2H14_CODE) {
    await runA2H14Trial(firestore, run, source, job, { client: options.client, model: options.model, modelProvider: options.modelProvider })
    return
  }
  if (job.benchmarkCode === A2H15_CODE) {
    await runA2H15Trial(firestore, run, source, job, { client: options.client, model: options.model, modelProvider: options.modelProvider, gptZeroApiKey: options.gptZeroApiKey })
    return
  }

  throw new Error(`Experimental trial for ${job.benchmarkCode} is not implemented.`)
}

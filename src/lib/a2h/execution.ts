import type { Firestore } from 'firebase-admin/firestore'
import type OpenAI from 'openai'
import {
  DEFAULT_DETECTOR_CONFIG_ID, FIXTURE_TYPE_FOR_TEST,
  type BenchmarkRun, type BenchmarkJob, type BenchmarkJobStage, type BenchmarkFixture,
} from './types'
import { getRun, maybeCompleteRun } from './runs'
import {
  getOrCreateJob, markJobRunning, markJobCompleted, markJobFailed, listJobsByStageAndStatus,
  transformJobId, postScoreJobId, testEvaluationJobId,
} from './jobs'
import { getSourceById } from './corpus'
import { acquireBaseline, acquirePostScore, getBaseline, getPostScore } from './baseline'
import { getOutputById, transformSource } from './outputs'
import { computeA2H01Measurements, A2H01_CODE } from './a2h01'
import { computeA2H02Measurements, A2H02_CODE } from './a2h02'
import { DETERMINISTIC_EVALUATORS } from './deterministicEvaluators'
import { listFixturesForSource } from './fixtures'
import { upsertTestResult } from './testResults'

export interface ExecuteBatchOptions {
  client: OpenAI
  model: string
  modelProvider: string
  gptZeroApiKey: string
  maxJobsPerStage?: number
}

export interface ExecuteBatchResult {
  processed: number
  stage: BenchmarkJobStage | 'idle'
  run: BenchmarkRun
}

const DEFAULT_MAX_JOBS_PER_STAGE = 5
const STAGE_ORDER: readonly BenchmarkJobStage[] = ['baseline_gptzero', 'humanite_transform', 'post_gptzero', 'test_evaluation']

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size))
  return chunks
}

// Processes one bounded batch of a run's queued work and returns immediately
// — this deployment has no background worker process, so "executing" a run
// means an admin-driven interactive call like this one, made repeatedly
// (the UI's "Continue Run" / "Run All" action loops this) until the run
// reports 'completed'. A call against a paused/cancelled/completed run is a
// safe no-op (§11: pause must not start additional queued work).
//
// Stages are drained in dependency order within one call: a later stage's
// jobs don't exist until the earlier stage that creates them (see below)
// has completed jobs to react to, so this only ever processes one stage per
// call — exactly the stage with work ready right now. Jobs within a batch
// run with up to run.concurrency in flight at once via Promise.all chunks.
export async function executeRunBatch(firestore: Firestore, runId: string, options: ExecuteBatchOptions): Promise<ExecuteBatchResult> {
  const run = await getRun(firestore, runId)
  if (!run) throw new Error('Benchmark run not found.')
  if (run.status !== 'running') {
    return { processed: 0, stage: 'idle', run }
  }

  const maxJobs = options.maxJobsPerStage ?? DEFAULT_MAX_JOBS_PER_STAGE
  const detectorConfigId = run.detectorConfigId ?? DEFAULT_DETECTOR_CONFIG_ID
  // One fixture query per source, shared across every test_evaluation job
  // this call processes (§48) — several deterministic tests (A2H-04/05/09/
  // 10/13) against the same source, and repeated intensities of the same
  // source, all resolve to the same cached read instead of one Firestore
  // query per output per test.
  const fixtureCache = new Map<string, Promise<BenchmarkFixture[]>>()

  for (const stage of STAGE_ORDER) {
    const queued = await listJobsByStageAndStatus(firestore, runId, stage, 'queued')
    if (queued.length === 0) continue

    const batch = queued.slice(0, maxJobs)
    let processed = 0
    for (const chunk of chunkArray(batch, Math.max(1, run.concurrency))) {
      await Promise.all(chunk.map(job => processJob(firestore, run, job, detectorConfigId, options, fixtureCache)))
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
): Promise<void> {
  await markJobRunning(firestore, job.id)
  try {
    if (job.stage === 'baseline_gptzero') {
      await runBaselineJob(firestore, run, job, detectorConfigId, options)
    } else if (job.stage === 'humanite_transform') {
      await runTransformJob(firestore, run, job, detectorConfigId, options)
    } else if (job.stage === 'post_gptzero') {
      await runPostScoreJob(firestore, run, job, detectorConfigId, options)
    } else if (job.stage === 'test_evaluation') {
      await runTestEvaluationJob(firestore, run, job, detectorConfigId, fixtureCache)
    }
    await markJobCompleted(firestore, job.id)
  } catch (err) {
    const errorCode = err instanceof Error ? err.constructor.name : 'UnknownError'
    const errorMessage = err instanceof Error ? err.message : 'Job failed.'
    await markJobFailed(firestore, job.id, errorCode, errorMessage)
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
    if (!FIXTURE_TYPE_FOR_TEST[job.benchmarkCode]) throw new Error(`No fixture type mapped for ${job.benchmarkCode}.`)
    if (!run.fixtureSetId) throw new Error(`Run ${run.id} has no fixtureSetId but enables fixture-backed test ${job.benchmarkCode}.`)
    const source = await getSourceById(firestore, output.sourceId)
    if (!source) throw new Error(`Source ${output.sourceId} not found.`)
    const fixtures = await getCachedFixtures(firestore, fixtureCache, run.fixtureSetId, output.sourceId)
    const evaluation = evaluator({ run, source, output, fixtures })
    await upsertTestResult(firestore, {
      runId: run.id,
      corpusProjectId: run.corpusProjectId,
      sourceId: output.sourceId,
      outputId: output.id,
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

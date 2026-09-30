import type { Firestore } from 'firebase-admin/firestore'
import {
  A2H_COLLECTIONS, IMPLEMENTED_A2H_TESTS, DEFAULT_ENABLED_TESTS, DEFAULT_TEST_VERSION, DEFAULT_DETECTOR_CONFIG_ID,
  FIXTURE_TYPE_FOR_TEST, FIXTURE_REQUIRING_TESTS,
  type BenchmarkRun, type BenchmarkRunSource, type A2HTestCode,
  type BenchmarkJobStage, type BenchmarkJobStatus,
} from './types'
import { getCorpusProject, getCorpusManifest } from './corpusProject'
import { listTopics, getTopic } from './topics'
import { getSource } from './corpus'
import { getHumaniteVersion, getGitCommit } from './buildInfo'
import { getOrCreateJob, listJobsForRun, cancelQueuedJobs, baselineJobId } from './jobs'
import { getFixtureSet, listFixturesForSource } from './fixtures'

const COLLECTION = A2H_COLLECTIONS.runs
const COHORT_COLLECTION = A2H_COLLECTIONS.runSources

export interface CreateRunParams {
  corpusProjectId: string
  name: string
  modelProvider: string
  model: string
  detectorConfigId?: string
  concurrency?: number
}

// Every run starts against the corpus's FULL current configuration (all
// selected domains, every topic, every configured length, intensities
// 1-10, and every implemented test) — per §4, "the standard case should
// require almost no configuration." An admin who wants a smaller dry run
// (§28) reduces the cohort afterward via updateRunDraft, while the run is
// still 'draft'.
export async function createRun(firestore: Firestore, params: CreateRunParams): Promise<BenchmarkRun> {
  if (!params.name?.trim()) throw new Error('name is required')

  const project = await getCorpusProject(firestore, params.corpusProjectId)
  if (!project) throw new Error('Corpus project not found.')
  if (project.status !== 'frozen') {
    throw new Error(`Cannot create a benchmark run — corpus project is ${project.status}, not frozen.`)
  }
  const manifest = await getCorpusManifest(firestore, params.corpusProjectId)
  if (!manifest) throw new Error('Corpus project has no manifest — freeze the corpus before creating a run.')

  const allTopics = await listTopics(firestore, params.corpusProjectId)
  const relevantTopics = allTopics.filter(t => project.domains.includes(t.domainId))

  const now = new Date().toISOString()
  const ref = firestore.collection(COLLECTION).doc()
  const run: BenchmarkRun = {
    id: ref.id,
    corpusProjectId: params.corpusProjectId,
    name: params.name.trim(),
    benchmarkVersion: project.benchmarkVersion,
    testVersion: DEFAULT_TEST_VERSION,
    corpusManifestHash: manifest.manifestHash,
    humaniteVersion: getHumaniteVersion(),
    gitCommit: getGitCommit(),
    modelProvider: params.modelProvider,
    model: params.model,
    detectorConfigId: params.detectorConfigId?.trim() || DEFAULT_DETECTOR_CONFIG_ID,
    selectedDomains: [...project.domains],
    selectedTopicIds: relevantTopics.map(t => t.id),
    selectedLengths: [...project.lengthLadder],
    intensities: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    enabledTests: [...DEFAULT_ENABLED_TESTS],
    fixtureSetId: null,
    fixtureVersion: null,
    concurrency: params.concurrency && params.concurrency > 0 ? Math.floor(params.concurrency) : 3,
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    validatedAt: null,
    startedAt: null,
    completedAt: null,
  }
  await ref.set(run)
  return run
}

export async function getRun(firestore: Firestore, id: string): Promise<BenchmarkRun | null> {
  const doc = await firestore.collection(COLLECTION).doc(id).get()
  return doc.exists ? (doc.data() as BenchmarkRun) : null
}

export async function listRunsForProject(firestore: Firestore, corpusProjectId: string): Promise<BenchmarkRun[]> {
  const snap = await firestore.collection(COLLECTION).where('corpusProjectId', '==', corpusProjectId).get()
  return snap.docs.map(d => d.data() as BenchmarkRun).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export type RunDraftPatch = Partial<
  Pick<BenchmarkRun, 'name' | 'selectedDomains' | 'selectedTopicIds' | 'selectedLengths' | 'intensities' | 'enabledTests' | 'concurrency' | 'modelProvider' | 'model' | 'detectorConfigId' | 'fixtureSetId'>
>

// Shape-level validation only (types, ranges, no duplicates) — full
// cross-referential validation against the corpus's own configuration (do
// these domains/topics/lengths actually exist there?) happens explicitly in
// checkRunValidity/validateRun, matching the UI's separate "Validate
// Configuration" step rather than re-fetching the corpus on every keystroke.
export async function updateRunDraft(firestore: Firestore, runId: string, patch: RunDraftPatch): Promise<BenchmarkRun> {
  const run = await getRun(firestore, runId)
  if (!run) throw new Error('Benchmark run not found.')
  if (run.status !== 'draft') throw new Error(`Cannot edit configuration — run is ${run.status}, not draft.`)

  const next: BenchmarkRun = { ...run }
  if (patch.name !== undefined) {
    if (!patch.name.trim()) throw new Error('name is required')
    next.name = patch.name.trim()
  }
  if (patch.selectedDomains !== undefined) {
    if (patch.selectedDomains.length === 0) throw new Error('Select at least one domain.')
    next.selectedDomains = [...new Set(patch.selectedDomains)]
  }
  if (patch.selectedTopicIds !== undefined) {
    if (patch.selectedTopicIds.length === 0) throw new Error('Select at least one topic.')
    next.selectedTopicIds = [...new Set(patch.selectedTopicIds)]
  }
  if (patch.selectedLengths !== undefined) {
    if (patch.selectedLengths.length === 0) throw new Error('Select at least one length.')
    next.selectedLengths = [...new Set(patch.selectedLengths)].sort((a, b) => a - b)
  }
  if (patch.intensities !== undefined) {
    if (patch.intensities.length === 0) throw new Error('Select at least one intensity.')
    for (const v of patch.intensities) {
      if (!Number.isInteger(v) || v < 1 || v > 10) throw new Error(`Invalid intensity value: ${v} (must be an integer 1-10).`)
    }
    next.intensities = [...new Set(patch.intensities)].sort((a, b) => a - b)
  }
  if (patch.enabledTests !== undefined) {
    if (patch.enabledTests.length === 0) throw new Error('At least one test must be enabled.')
    const invalid = patch.enabledTests.filter(t => !IMPLEMENTED_A2H_TESTS.includes(t))
    if (invalid.length > 0) throw new Error(`Test(s) not yet implemented: ${invalid.join(', ')}.`)
    next.enabledTests = [...new Set(patch.enabledTests)]
  }
  if (patch.concurrency !== undefined) {
    if (!Number.isInteger(patch.concurrency) || patch.concurrency < 1) throw new Error('concurrency must be a positive integer.')
    next.concurrency = patch.concurrency
  }
  if (patch.modelProvider !== undefined) next.modelProvider = patch.modelProvider
  if (patch.model !== undefined) next.model = patch.model
  if (patch.detectorConfigId !== undefined) next.detectorConfigId = patch.detectorConfigId?.trim() || DEFAULT_DETECTOR_CONFIG_ID
  // Shape-level only, matching the rest of this function — whether the
  // fixture set actually belongs to this project and is locked is checked
  // in checkRunValidity/validateRun, not here.
  if (patch.fixtureSetId !== undefined) next.fixtureSetId = patch.fixtureSetId?.trim() || null

  next.updatedAt = new Date().toISOString()
  await firestore.collection(COLLECTION).doc(runId).set(next)
  return next
}

export interface RunValidationResult {
  ok: boolean
  errors: string[]
}

// The full §24 precondition checklist — accumulates every failure rather
// than stopping at the first, so the UI/API can show every actionable error
// at once instead of a fix-one-resubmit-find-the-next loop. hasModelConfig/
// hasDetectorConfig are supplied by the caller (an API route, which already
// resolved the requesting admin's own settings) rather than read from here,
// since this module has no business reaching into per-user R2 config.
export async function checkRunValidity(
  firestore: Firestore,
  run: BenchmarkRun,
  options: { hasModelConfig: boolean; hasDetectorConfig: boolean },
): Promise<RunValidationResult> {
  const errors: string[] = []

  const project = await getCorpusProject(firestore, run.corpusProjectId)
  if (!project) {
    errors.push('Corpus project not found.')
    return { ok: false, errors }
  }
  if (project.status !== 'frozen') errors.push(`Corpus project is ${project.status}, not frozen.`)

  const manifest = await getCorpusManifest(firestore, run.corpusProjectId)
  if (!manifest) {
    errors.push('Corpus project has no manifest.')
  } else if (manifest.manifestHash !== run.corpusManifestHash) {
    errors.push("The run's snapshotted corpus manifest hash no longer matches the corpus's current manifest.")
  }

  if (run.selectedDomains.length === 0) {
    errors.push('At least one domain must be selected.')
  } else {
    const invalidDomains = run.selectedDomains.filter(d => !project.domains.includes(d))
    if (invalidDomains.length > 0) errors.push(`Selected domain(s) do not exist in the corpus design: ${invalidDomains.join(', ')}.`)
  }

  if (run.selectedLengths.length === 0) {
    errors.push('At least one length must be selected.')
  } else {
    const invalidLengths = run.selectedLengths.filter(l => !project.lengthLadder.includes(l))
    if (invalidLengths.length > 0) errors.push(`Selected length(s) do not exist in the corpus design: ${invalidLengths.join(', ')}.`)
  }

  if (run.selectedTopicIds.length === 0) {
    errors.push('At least one topic must be selected.')
  } else {
    const allTopics = await listTopics(firestore, run.corpusProjectId)
    const topicsById = new Map(allTopics.map(t => [t.id, t]))
    for (const topicId of run.selectedTopicIds) {
      const topic = topicsById.get(topicId)
      if (!topic) {
        errors.push(`Selected topic ${topicId} does not belong to this corpus project.`)
      } else if (!run.selectedDomains.includes(topic.domainId)) {
        errors.push(`Selected topic "${topic.title}" belongs to domain ${topic.domainId}, which is not selected.`)
      }
    }
  }

  const intensitySet = new Set(run.intensities)
  if (run.intensities.length === 0) {
    errors.push('At least one intensity must be selected.')
  } else {
    if (intensitySet.size !== run.intensities.length) errors.push('Intensities contain duplicate values.')
    for (const i of run.intensities) {
      if (!Number.isInteger(i) || i < 1 || i > 10) errors.push(`Invalid intensity value: ${i} (must be an integer between 1 and 10).`)
    }
  }

  if (run.enabledTests.length === 0) errors.push('At least one test must be enabled.')
  if (run.enabledTests.includes('A2H-02') && intensitySet.size < 2) {
    errors.push('A2H-02 (Intensity Response) requires at least 2 selected intensities.')
  }

  const needsDetector = run.enabledTests.some(t => t === 'A2H-01' || t === 'A2H-02' || t === 'A2H-03')
  if (needsDetector && !options.hasDetectorConfig) {
    errors.push('GPTZero is not configured — required by the enabled A2H-01/02/03 tests.')
  }
  if (!options.hasModelConfig) {
    errors.push('A Humanite model/provider is not configured.')
  }

  // §4/§27: any of A2H-04/05/09/10/13 requires a fixture set that belongs to
  // this project and is locked — never a mutable "current" fixture set
  // resolved later.
  const needsFixtureSet = run.enabledTests.some(t => FIXTURE_REQUIRING_TESTS.includes(t))
  if (needsFixtureSet) {
    if (!run.fixtureSetId) {
      errors.push(`A locked fixture set is required — enabled tests include ${run.enabledTests.filter(t => FIXTURE_REQUIRING_TESTS.includes(t)).join(', ')}.`)
    } else {
      const fixtureSet = await getFixtureSet(firestore, run.fixtureSetId)
      if (!fixtureSet) {
        errors.push('The selected fixture set no longer exists.')
      } else {
        if (fixtureSet.corpusProjectId !== run.corpusProjectId) errors.push('The selected fixture set does not belong to this corpus project.')
        if (fixtureSet.status !== 'locked') errors.push(`The selected fixture set is ${fixtureSet.status}, not locked.`)
      }
    }
  }

  // Only check actual cell coverage once everything else is sound — no
  // point issuing hundreds of "missing frozen source" errors for topic ids
  // that don't even belong to this project.
  if (errors.length === 0) {
    const missing: string[] = []
    await Promise.all(run.selectedTopicIds.flatMap(topicId =>
      run.selectedLengths.map(async targetWords => {
        const source = await getSource(firestore, run.corpusProjectId, topicId, targetWords)
        if (!source || source.status !== 'frozen') missing.push(`${topicId}@${targetWords}`)
      }),
    ))
    if (missing.length > 0) {
      errors.push(`${missing.length} selected topic/length cell(s) have no frozen source.`)
    }
  }

  return { ok: errors.length === 0, errors }
}

// Runs the full checklist and, only on success, freezes the selected source
// cohort into BenchmarkRunSource rows (§6) — the exact set of sources
// contributing to this run becomes permanently recorded here, never
// re-inferred from the run's filters again after this point.
export async function validateRun(
  firestore: Firestore,
  runId: string,
  options: { hasModelConfig: boolean; hasDetectorConfig: boolean },
): Promise<{ run: BenchmarkRun; result: RunValidationResult }> {
  const run = await getRun(firestore, runId)
  if (!run) throw new Error('Benchmark run not found.')
  if (run.status !== 'draft' && run.status !== 'validated') {
    throw new Error(`Cannot validate — run is already ${run.status}.`)
  }

  const result = await checkRunValidity(firestore, run, options)
  if (!result.ok) return { run, result }

  const cells = run.selectedTopicIds.flatMap(topicId => run.selectedLengths.map(targetWords => ({ topicId, targetWords })))
  await Promise.all(cells.map(async ({ topicId, targetWords }) => {
    const [topic, source] = await Promise.all([
      getTopic(firestore, topicId),
      getSource(firestore, run.corpusProjectId, topicId, targetWords),
    ])
    const cohortRow: BenchmarkRunSource = {
      id: `${runId}__${source!.id}`,
      runId,
      corpusProjectId: run.corpusProjectId,
      sourceId: source!.id,
      domainId: topic!.domainId,
      topicId,
      targetWords,
      sourceSha256: source!.sha256,
    }
    await firestore.collection(COHORT_COLLECTION).doc(cohortRow.id).set(cohortRow)
  }))

  // Snapshot the fixture set's version now (§4) — never re-resolved from a
  // mutable "current fixture set" later. checkRunValidity already confirmed
  // fixtureSetId is set and locked whenever it's required.
  const fixtureVersion = run.fixtureSetId ? (await getFixtureSet(firestore, run.fixtureSetId))!.fixtureVersion : null

  const now = new Date().toISOString()
  const updated: BenchmarkRun = { ...run, status: 'validated', fixtureVersion, validatedAt: now, updatedAt: now }
  await firestore.collection(COLLECTION).doc(runId).set(updated)
  return { run: updated, result }
}

export interface FixtureTestEligibility {
  eligibleSourceCount: number
  eligibleOutputCount: number
  totalSourceCount: number
  totalOutputCount: number
}

// §27's pre-run coverage display ("A2H-04 eligible outputs: 3,120 / 12,000")
// — computed from the run's already-snapshotted cohort (BenchmarkRunSource
// rows) and fixture set, before any output exists yet, so eligibility can be
// shown up front rather than discovered only after execution. One fixture
// query per cohort source (not per source per test), reused across every
// enabled fixture-requiring test for that source.
export async function computeFixtureEligibility(firestore: Firestore, run: BenchmarkRun): Promise<Partial<Record<A2HTestCode, FixtureTestEligibility>>> {
  const relevantTests = run.enabledTests.filter(t => FIXTURE_REQUIRING_TESTS.includes(t))
  if (relevantTests.length === 0 || !run.fixtureSetId) return {}

  const cohort = await listRunSources(firestore, run.id)
  const fixtureSetId = run.fixtureSetId
  const fixturesBySource = new Map(await Promise.all(cohort.map(async row => [row.sourceId, await listFixturesForSource(firestore, fixtureSetId, row.sourceId)] as const)))

  const result: Partial<Record<A2HTestCode, FixtureTestEligibility>> = {}
  for (const code of relevantTests) {
    const fixtureType = FIXTURE_TYPE_FOR_TEST[code]!
    const eligibleSourceCount = cohort.filter(row => (fixturesBySource.get(row.sourceId) ?? []).some(f => f.type === fixtureType)).length
    result[code] = {
      eligibleSourceCount,
      eligibleOutputCount: eligibleSourceCount * run.intensities.length,
      totalSourceCount: cohort.length,
      totalOutputCount: cohort.length * run.intensities.length,
    }
  }
  return result
}

export async function listRunSources(firestore: Firestore, runId: string): Promise<BenchmarkRunSource[]> {
  const snap = await firestore.collection(COHORT_COLLECTION).where('runId', '==', runId).get()
  return snap.docs.map(d => d.data() as BenchmarkRunSource)
}

// The only place baseline_gptzero jobs are created — one per cohort source,
// idempotently (a second start-from-validated on the same run, or a retried
// click, resolves to the same job rows rather than duplicating them).
// Every later stage's jobs are enqueued progressively, as each prerequisite
// job completes (see execution.ts) — starting a run never pre-creates
// thousands of transform/post-score/test rows up front.
export async function startRun(firestore: Firestore, runId: string): Promise<BenchmarkRun> {
  const run = await getRun(firestore, runId)
  if (!run) throw new Error('Benchmark run not found.')
  if (run.status !== 'validated') throw new Error(`Cannot start — run is ${run.status}, not validated. Validate the run first.`)

  const cohort = await listRunSources(firestore, runId)
  const detectorConfigId = run.detectorConfigId ?? DEFAULT_DETECTOR_CONFIG_ID
  await Promise.all(cohort.map(row => getOrCreateJob(firestore, {
    id: baselineJobId(runId, row.sourceId, detectorConfigId),
    runId,
    corpusProjectId: run.corpusProjectId,
    stage: 'baseline_gptzero',
    sourceId: row.sourceId,
  })))

  const now = new Date().toISOString()
  const updated: BenchmarkRun = { ...run, status: 'running', startedAt: run.startedAt ?? now, updatedAt: now }
  await firestore.collection(COLLECTION).doc(runId).set(updated)
  return updated
}

export async function pauseRun(firestore: Firestore, runId: string): Promise<BenchmarkRun> {
  const run = await getRun(firestore, runId)
  if (!run) throw new Error('Benchmark run not found.')
  if (run.status !== 'running') throw new Error(`Cannot pause — run is ${run.status}, not running.`)
  const updated: BenchmarkRun = { ...run, status: 'paused', updatedAt: new Date().toISOString() }
  await firestore.collection(COLLECTION).doc(runId).set(updated)
  return updated
}

export async function resumeRun(firestore: Firestore, runId: string): Promise<BenchmarkRun> {
  const run = await getRun(firestore, runId)
  if (!run) throw new Error('Benchmark run not found.')
  if (run.status !== 'paused') throw new Error(`Cannot resume — run is ${run.status}, not paused.`)
  const updated: BenchmarkRun = { ...run, status: 'running', updatedAt: new Date().toISOString() }
  await firestore.collection(COLLECTION).doc(runId).set(updated)
  return updated
}

// Preserves every completed output/result — only queued/retrying jobs are
// cancelled (§11: "Do not delete completed outputs/results.").
export async function cancelRun(firestore: Firestore, runId: string): Promise<BenchmarkRun> {
  const run = await getRun(firestore, runId)
  if (!run) throw new Error('Benchmark run not found.')
  if (run.status === 'completed' || run.status === 'cancelled') {
    throw new Error(`Cannot cancel — run is already ${run.status}.`)
  }
  await cancelQueuedJobs(firestore, runId)
  const updated: BenchmarkRun = { ...run, status: 'cancelled', updatedAt: new Date().toISOString() }
  await firestore.collection(COLLECTION).doc(runId).set(updated)
  return updated
}

// Called after each executed batch (see execution.ts) — a run reaches
// 'completed' once every job it owns has reached a terminal state
// (completed/failed/cancelled), regardless of individual job failures
// (those stay visible via progress.failedJobs rather than blocking
// completion outright).
export async function maybeCompleteRun(firestore: Firestore, runId: string): Promise<BenchmarkRun | null> {
  const run = await getRun(firestore, runId)
  if (!run || run.status !== 'running') return null
  const jobs = await listJobsForRun(firestore, runId)
  if (jobs.length === 0) return null
  const unfinished = jobs.some(j => j.status === 'queued' || j.status === 'running' || j.status === 'retrying')
  if (unfinished) return null
  const now = new Date().toISOString()
  const updated: BenchmarkRun = { ...run, status: 'completed', completedAt: now, updatedAt: now }
  await firestore.collection(COLLECTION).doc(runId).set(updated)
  return updated
}

export interface RunProgress {
  sources: number
  baselinesTotal: number
  baselinesCompleted: number
  outputsTotal: number
  outputsCompleted: number
  postScoresTotal: number
  postScoresCompleted: number
  testResultsTotal: number
  a2h01ResultsCompleted: number
  a2h02ResultsCompleted: number
  // Generic per-test completed-job counts for every fixture-backed
  // deterministic test enabled on this run (A2H-04/05/09/10/13, ...) — kept
  // separate from the two named A2H-01/02 fields above (which predate this
  // phase and existing UI already reads directly) rather than folding
  // everything into one map and breaking that shape.
  deterministicResultsCompleted: Partial<Record<A2HTestCode, number>>
  failedJobs: number
  queuedJobs: number
}

function countByStageStatus(
  jobs: { stage: BenchmarkJobStage; status: BenchmarkJobStatus; benchmarkCode: A2HTestCode | null }[],
  stage: BenchmarkJobStage,
  status: BenchmarkJobStatus,
): number {
  return jobs.filter(j => j.stage === stage && j.status === status).length
}

export async function getRunProgress(firestore: Firestore, runId: string): Promise<RunProgress> {
  const run = await getRun(firestore, runId)
  if (!run) throw new Error('Benchmark run not found.')
  const [cohort, jobs] = await Promise.all([listRunSources(firestore, runId), listJobsForRun(firestore, runId)])

  const sourcesCount = cohort.length
  const outputsTotal = sourcesCount * run.intensities.length
  const testCodesForEvaluation = run.enabledTests.filter((t): t is 'A2H-01' | 'A2H-02' => t === 'A2H-01' || t === 'A2H-02')
  const testResultsTotal = outputsTotal * testCodesForEvaluation.length

  const deterministicResultsCompleted: Partial<Record<A2HTestCode, number>> = {}
  for (const code of run.enabledTests.filter(t => FIXTURE_REQUIRING_TESTS.includes(t))) {
    deterministicResultsCompleted[code] = jobs.filter(j => j.stage === 'test_evaluation' && j.status === 'completed' && j.benchmarkCode === code).length
  }

  return {
    sources: sourcesCount,
    baselinesTotal: sourcesCount,
    baselinesCompleted: countByStageStatus(jobs, 'baseline_gptzero', 'completed'),
    outputsTotal,
    outputsCompleted: countByStageStatus(jobs, 'humanite_transform', 'completed'),
    postScoresTotal: outputsTotal,
    postScoresCompleted: countByStageStatus(jobs, 'post_gptzero', 'completed'),
    testResultsTotal,
    a2h01ResultsCompleted: jobs.filter(j => j.stage === 'test_evaluation' && j.status === 'completed' && j.benchmarkCode === 'A2H-01').length,
    a2h02ResultsCompleted: jobs.filter(j => j.stage === 'test_evaluation' && j.status === 'completed' && j.benchmarkCode === 'A2H-02').length,
    deterministicResultsCompleted,
    failedJobs: jobs.filter(j => j.status === 'failed').length,
    queuedJobs: jobs.filter(j => j.status === 'queued' || j.status === 'retrying').length,
  }
}

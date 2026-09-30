import type { Firestore } from 'firebase-admin/firestore'
import {
  A2H_COLLECTIONS, IMPLEMENTED_A2H_TESTS, DEFAULT_ENABLED_TESTS, DEFAULT_TEST_VERSION, DEFAULT_DETECTOR_CONFIG_ID,
  DEFAULT_REPAIR_CONFIG_VERSION, FIXTURE_TYPE_FOR_TEST, FIXTURE_REQUIRING_TESTS, EXPERIMENTAL_TRIAL_TEST_CODES,
  type BenchmarkRun, type BenchmarkRunSource, type A2HTestCode, type BenchmarkExperimentConfig,
  type BenchmarkJobStage, type BenchmarkJobStatus, type BenchmarkExperimentalTestCode,
} from './types'
import { getCorpusProject, getCorpusManifest } from './corpusProject'
import { listTopics, getTopic } from './topics'
import { getSource } from './corpus'
import { getHumaniteVersion, getGitCommit } from './buildInfo'
import { getOrCreateJob, listJobsForRun, cancelQueuedJobs, baselineJobId, repairEvaluationJobId, experimentalTrialJobId } from './jobs'
import { getFixtureSet, listFixturesForSource, listFixturesForSet } from './fixtures'
import { GRAMMAR_ENGINE_VERSION } from './grammarEngine'
import { getOrCreateExperimentCohort, getExperimentCohort } from './experimentCohort'
import { candidateCountForIntensity } from '@/lib/selection'
import { generateA2H07Conditions } from './a2h07'
import { generateA2H11Conditions, INITIAL_STYLE_TONE_CONTRASTS } from './a2h11'
import { generateA2H14Conditions, INITIAL_GENRE_AUDIENCE_CONTRASTS } from './a2h14'
import { generateA2H15Conditions } from './a2h15'

// Tests whose enablement requires a locked fixture set AND makes a paid
// targeted-repair model call per fixture (§22-26), rather than a pure local
// computation — enqueued via their own repair_evaluation jobs in startRun,
// never through the test_evaluation stage.
const REPAIR_TEST_CODES: readonly A2HTestCode[] = ['A2H-06', 'A2H-12']

// Fixture-backed tests that must have at least one fixture of their own type
// before they can be enabled — a locked-but-empty set is not enough. Beyond
// REPAIR_TEST_CODES, A2H-16 (Phase 4) shares this requirement (§38); the
// other fixture-requiring tests (A2H-04/05/09/10/13) deliberately do NOT
// (§27: coverage is reported, never enforced as complete for those).
const FIXTURE_COVERAGE_REQUIRED_TESTS: readonly A2HTestCode[] = ['A2H-06', 'A2H-12', 'A2H-16']

// Sensible, deliberately modest defaults (§42: "do not automatically enable
// all expensive experimental tests" extends to their scale too) — an admin
// who enables an experimental test without configuring it explicitly gets a
// bounded, documented default rather than the full cohort at full repeat
// count. Never mutates run.experimentConfig itself; only used to compute
// what WOULD apply, for validation (§38) and the pre-start work estimate
// (§39). validateRun snapshots the merged result once, permanently.
export function effectiveExperimentConfig(run: BenchmarkRun): BenchmarkExperimentConfig {
  const config = run.experimentConfig ?? {}
  const result: BenchmarkExperimentConfig = { ...config }
  if (run.enabledTests.includes('A2H-07') && !result.repeatability) {
    result.repeatability = { repeatCount: 5, sourceSampleSize: 10, intensities: [3, 6, 9] }
  }
  if (run.enabledTests.includes('A2H-11') && !result.styleTone) {
    result.styleTone = { contrasts: INITIAL_STYLE_TONE_CONTRASTS, sourceSampleSize: 10 }
  }
  if (run.enabledTests.includes('A2H-14') && !result.genreAudience) {
    result.genreAudience = { contrasts: INITIAL_GENRE_AUDIENCE_CONTRASTS, sourceSampleSize: 10 }
  }
  if (run.enabledTests.includes('A2H-15') && !result.candidateSelection) {
    result.candidateSelection = { intensities: [5, 8], sourceSampleSize: 10 }
  }
  return result
}

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
    repairConfigVersion: DEFAULT_REPAIR_CONFIG_VERSION,
    grammarEngineConfigVersion: GRAMMAR_ENGINE_VERSION,
    experimentConfig: null,
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
  Pick<BenchmarkRun, 'name' | 'selectedDomains' | 'selectedTopicIds' | 'selectedLengths' | 'intensities' | 'enabledTests' | 'concurrency' | 'modelProvider' | 'model' | 'detectorConfigId' | 'fixtureSetId' | 'experimentConfig'>
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
  // An explicit admin override of the experimental-test configuration
  // (repeat count, sample size, contrasts, intensities) — shape-level only,
  // matching the rest of this function; §38's substantive checks
  // (repeatCount >= 2, at least one contrast, ...) run in checkRunValidity.
  if (patch.experimentConfig !== undefined) next.experimentConfig = patch.experimentConfig

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

  // A2H-07/A2H-15 also call GPTZero directly on each trial (§38).
  const needsDetector = run.enabledTests.some(t => t === 'A2H-01' || t === 'A2H-02' || t === 'A2H-03' || t === 'A2H-07' || t === 'A2H-15')
  if (needsDetector && !options.hasDetectorConfig) {
    errors.push('GPTZero is not configured — required by the enabled A2H-01/02/03/07/15 tests.')
  }
  if (!options.hasModelConfig) {
    errors.push('A Humanite model/provider is not configured.')
  }

  // §38: per-experimental-test preconditions. Config sections are optional
  // on the run (defaults apply — see effectiveExperimentConfig) so these
  // checks validate whatever WOULD be in effect, not only an admin's
  // explicit override.
  const effectiveConfig = effectiveExperimentConfig(run)
  if (run.enabledTests.includes('A2H-07')) {
    const repeatCount = effectiveConfig.repeatability?.repeatCount ?? 0
    if (repeatCount < 2) errors.push('A2H-07 (Repeatability) requires repeatCount >= 2.')
  }
  if (run.enabledTests.includes('A2H-11')) {
    const contrasts = effectiveConfig.styleTone?.contrasts ?? []
    if (contrasts.length === 0) errors.push('A2H-11 (Style/Tone Control) requires at least one tone contrast.')
  }
  if (run.enabledTests.includes('A2H-14')) {
    const contrasts = effectiveConfig.genreAudience?.contrasts ?? []
    if (contrasts.length === 0) errors.push('A2H-14 (Genre/Audience Control) requires at least one genre/audience contrast.')
  }
  if (run.enabledTests.includes('A2H-15')) {
    const intensities = effectiveConfig.candidateSelection?.intensities ?? []
    if (!intensities.some(i => candidateCountForIntensity(i) > 1)) {
      errors.push('A2H-15 (Candidate Selection Effectiveness) requires at least one configured intensity that actually invokes candidate search (intensity >= 4).')
    }
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

        // §27/§38: A2H-06/A2H-12/A2H-16 additionally require at least one
        // fixture of their own type to exist in the set — a locked-but-empty
        // set is not enough. A2H-08 is deliberately exempt (§27: "do not
        // require fixture coverage for A2H-08"), as are A2H-04/05/09/10/13
        // (coverage is reported, never enforced as complete, for those).
        if (fixtureSet.status === 'locked' && fixtureSet.corpusProjectId === run.corpusProjectId) {
          const coverageRequiredTests = run.enabledTests.filter(t => FIXTURE_COVERAGE_REQUIRED_TESTS.includes(t))
          if (coverageRequiredTests.length > 0) {
            const allFixtures = await listFixturesForSet(firestore, run.fixtureSetId)
            for (const code of coverageRequiredTests) {
              const fixtureType = FIXTURE_TYPE_FOR_TEST[code]!
              if (!allFixtures.some(f => f.type === fixtureType)) {
                errors.push(`${code} is enabled but the fixture set has zero ${fixtureType} fixtures.`)
              }
            }
          }
        }
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

  // Snapshot the effective experimental-test configuration too (§2) — an
  // admin's explicit override is preserved as-is; any experimental test
  // enabled WITHOUT one gets the same bounded defaults checkRunValidity just
  // validated against, permanently, so this run's config never silently
  // drifts if the built-in defaults change later.
  const experimentConfig = effectiveExperimentConfig(run)

  const now = new Date().toISOString()
  const updated: BenchmarkRun = { ...run, status: 'validated', fixtureVersion, experimentConfig, validatedAt: now, updatedAt: now }
  await firestore.collection(COLLECTION).doc(runId).set(updated)

  // Freeze each enabled experimental test's own stratified cohort (§41) —
  // write-once, from the SAME just-frozen BenchmarkRunSource rows every
  // other test's cohort is scoped to, never resampled on a later call.
  const cohortRows = await listRunSources(firestore, runId)
  await Promise.all(EXPERIMENTAL_TRIAL_TEST_CODES.filter(code => run.enabledTests.includes(code)).map(code => {
    const sampleSize = code === 'A2H-07' ? experimentConfig.repeatability?.sourceSampleSize ?? null
      : code === 'A2H-11' ? experimentConfig.styleTone?.sourceSampleSize ?? null
        : code === 'A2H-14' ? experimentConfig.genreAudience?.sourceSampleSize ?? null
          : experimentConfig.candidateSelection?.sourceSampleSize ?? null
    return getOrCreateExperimentCohort(firestore, runId, code, cohortRows, sampleSize)
  }))

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

  // A2H-06/A2H-12 (§22-26) enqueue independently of the baseline/transform/
  // post-score pipeline above — they operate on fixtures, not outputs, so
  // there is nothing to wait on. One repair_evaluation job per (cohort
  // source's fixture of the relevant type), keyed by the run's own
  // repairConfigVersion snapshot.
  const enabledRepairTests = run.enabledTests.filter(t => REPAIR_TEST_CODES.includes(t))
  if (enabledRepairTests.length > 0 && run.fixtureSetId) {
    const fixtureSetId = run.fixtureSetId
    await Promise.all(cohort.map(async row => {
      const sourceFixtures = await listFixturesForSource(firestore, fixtureSetId, row.sourceId)
      const jobsForRow: Promise<unknown>[] = []
      for (const code of enabledRepairTests) {
        const fixtureType = FIXTURE_TYPE_FOR_TEST[code]!
        for (const fixture of sourceFixtures.filter(f => f.type === fixtureType)) {
          jobsForRow.push(getOrCreateJob(firestore, {
            id: repairEvaluationJobId(runId, fixture.id, code, run.repairConfigVersion),
            runId,
            corpusProjectId: run.corpusProjectId,
            stage: 'repair_evaluation',
            sourceId: row.sourceId,
            fixtureId: fixture.id,
            benchmarkCode: code,
          }))
        }
      }
      await Promise.all(jobsForRow)
    }))
  }

  // A2H-07/11/14/15 (Phase 4, §36): enqueue independently of the baseline/
  // transform/post-score pipeline, against each test's own frozen
  // experimental cohort (never the full main cohort) — one experimental_trial
  // job per condition/repeat that test's own generator function defines.
  await Promise.all(EXPERIMENTAL_TRIAL_TEST_CODES.filter(code => run.enabledTests.includes(code)).map(async code => {
    const experimentCohort = await getExperimentCohort(firestore, runId, code)
    if (!experimentCohort) return
    const config = run.experimentConfig
    const jobs: Promise<unknown>[] = []

    if (code === 'A2H-07' && config?.repeatability) {
      const { repeatCount, intensities } = config.repeatability
      for (const c of generateA2H07Conditions(experimentCohort.sourceIds, intensities, repeatCount, run.model, run.humaniteVersion)) {
        jobs.push(getOrCreateJob(firestore, {
          id: experimentalTrialJobId(runId, code, c.sourceId, c.conditionId, c.trialIndex),
          runId, corpusProjectId: run.corpusProjectId, stage: 'experimental_trial',
          sourceId: c.sourceId, benchmarkCode: code, conditionId: c.conditionId, trialIndex: c.trialIndex, intensity: c.intensity,
        }))
      }
    } else if (code === 'A2H-11' && config?.styleTone) {
      for (const c of generateA2H11Conditions(experimentCohort.sourceIds, config.styleTone.contrasts)) {
        jobs.push(getOrCreateJob(firestore, {
          id: experimentalTrialJobId(runId, code, c.sourceId, c.conditionId, 0),
          runId, corpusProjectId: run.corpusProjectId, stage: 'experimental_trial',
          sourceId: c.sourceId, benchmarkCode: code, conditionId: c.conditionId, trialIndex: 0,
        }))
      }
    } else if (code === 'A2H-14' && config?.genreAudience) {
      for (const c of generateA2H14Conditions(experimentCohort.sourceIds, config.genreAudience.contrasts)) {
        jobs.push(getOrCreateJob(firestore, {
          id: experimentalTrialJobId(runId, code, c.sourceId, c.conditionId, 0),
          runId, corpusProjectId: run.corpusProjectId, stage: 'experimental_trial',
          sourceId: c.sourceId, benchmarkCode: code, conditionId: c.conditionId, trialIndex: 0,
        }))
      }
    } else if (code === 'A2H-15' && config?.candidateSelection) {
      for (const c of generateA2H15Conditions(experimentCohort.sourceIds, config.candidateSelection.intensities)) {
        jobs.push(getOrCreateJob(firestore, {
          id: experimentalTrialJobId(runId, code, c.sourceId, c.conditionId, 0),
          runId, corpusProjectId: run.corpusProjectId, stage: 'experimental_trial',
          sourceId: c.sourceId, benchmarkCode: code, conditionId: c.conditionId, trialIndex: 0, intensity: c.intensity,
        }))
      }
    }
    await Promise.all(jobs)
  }))

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
  // A2H-06/A2H-12 repair-attempt job counts (§49) — kept separate from
  // deterministicResultsCompleted since these are paid, fixture-scoped
  // repair_evaluation jobs, not free test_evaluation ones, and their total
  // is the fixture count for that test, not sources x intensities.
  repairJobsTotal: Partial<Record<A2HTestCode, number>>
  repairJobsCompleted: Partial<Record<A2HTestCode, number>>
  // A2H-07/11/14/15 (Phase 4) experimental_trial job counts — kept separate
  // from repairJobsTotal/Completed since these are a different job stage
  // with a different (condition/repeat-based, not fixture-based) total.
  trialJobsTotal: Partial<Record<A2HTestCode, number>>
  trialJobsCompleted: Partial<Record<A2HTestCode, number>>
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
  for (const code of run.enabledTests.filter(t => FIXTURE_REQUIRING_TESTS.includes(t) && !REPAIR_TEST_CODES.includes(t))) {
    deterministicResultsCompleted[code] = jobs.filter(j => j.stage === 'test_evaluation' && j.status === 'completed' && j.benchmarkCode === code).length
  }

  const repairJobsTotal: Partial<Record<A2HTestCode, number>> = {}
  const repairJobsCompleted: Partial<Record<A2HTestCode, number>> = {}
  for (const code of run.enabledTests.filter(t => REPAIR_TEST_CODES.includes(t))) {
    const repairJobsForCode = jobs.filter(j => j.stage === 'repair_evaluation' && j.benchmarkCode === code)
    repairJobsTotal[code] = repairJobsForCode.length
    repairJobsCompleted[code] = repairJobsForCode.filter(j => j.status === 'completed').length
  }

  const trialJobsTotal: Partial<Record<A2HTestCode, number>> = {}
  const trialJobsCompleted: Partial<Record<A2HTestCode, number>> = {}
  for (const code of run.enabledTests.filter(t => EXPERIMENTAL_TRIAL_TEST_CODES.includes(t))) {
    const trialJobsForCode = jobs.filter(j => j.stage === 'experimental_trial' && j.benchmarkCode === code)
    trialJobsTotal[code] = trialJobsForCode.length
    trialJobsCompleted[code] = trialJobsForCode.filter(j => j.status === 'completed').length
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
    repairJobsTotal,
    repairJobsCompleted,
    trialJobsTotal,
    trialJobsCompleted,
    failedJobs: jobs.filter(j => j.status === 'failed').length,
    queuedJobs: jobs.filter(j => j.status === 'queued' || j.status === 'retrying').length,
  }
}

// ── Pre-start work estimate (§39) ─────────────────────────────────────────
//
// Callable once a run is validated (main + experimental cohorts are already
// frozen at that point) — never before, and never re-derived from mutable
// UI defaults once the run starts, matching every other reproducibility-
// affecting computation in this module.
export interface RunWorkEstimate {
  normalTransformations: number
  repairAttempts: number
  repeatabilityTrials: number
  styleToneTrials: number
  genreAudienceTrials: number
  candidateSelectionTrials: number
  estimatedTotalModelOperations: number
}

export async function estimateRunWork(firestore: Firestore, run: BenchmarkRun): Promise<RunWorkEstimate> {
  const cohort = await listRunSources(firestore, run.id)
  const normalTransformations = cohort.length * run.intensities.length

  let repairAttempts = 0
  const enabledRepairTests = run.enabledTests.filter(t => REPAIR_TEST_CODES.includes(t))
  if (enabledRepairTests.length > 0 && run.fixtureSetId) {
    const allFixtures = await listFixturesForSet(firestore, run.fixtureSetId)
    for (const code of enabledRepairTests) {
      const fixtureType = FIXTURE_TYPE_FOR_TEST[code]!
      repairAttempts += allFixtures.filter(f => f.type === fixtureType).length
    }
  }

  const config = effectiveExperimentConfig(run)
  let repeatabilityTrials = 0
  let styleToneTrials = 0
  let genreAudienceTrials = 0
  let candidateSelectionTrials = 0

  if (run.enabledTests.includes('A2H-07') && config.repeatability) {
    const experimentCohort = await getExperimentCohort(firestore, run.id, 'A2H-07')
    const n = experimentCohort?.sourceIds.length ?? 0
    repeatabilityTrials = n * config.repeatability.intensities.length * config.repeatability.repeatCount
  }
  if (run.enabledTests.includes('A2H-11') && config.styleTone) {
    const experimentCohort = await getExperimentCohort(firestore, run.id, 'A2H-11')
    const n = experimentCohort?.sourceIds.length ?? 0
    styleToneTrials = n * config.styleTone.contrasts.length * 2
  }
  if (run.enabledTests.includes('A2H-14') && config.genreAudience) {
    const experimentCohort = await getExperimentCohort(firestore, run.id, 'A2H-14')
    const n = experimentCohort?.sourceIds.length ?? 0
    genreAudienceTrials = n * config.genreAudience.contrasts.length * 2
  }
  if (run.enabledTests.includes('A2H-15') && config.candidateSelection) {
    const experimentCohort = await getExperimentCohort(firestore, run.id, 'A2H-15')
    const n = experimentCohort?.sourceIds.length ?? 0
    const eligibleIntensities = config.candidateSelection.intensities.filter(i => candidateCountForIntensity(i) > 1)
    candidateSelectionTrials = n * eligibleIntensities.length * 2
  }

  const humaniteOperations = normalTransformations + repairAttempts + repeatabilityTrials + styleToneTrials + genreAudienceTrials + candidateSelectionTrials
  // GPTZero calls: one baseline + one post-transform per normal
  // transformation, plus one per A2H-07/A2H-15 trial (the only trial-based
  // tests that call the detector) — folded into one total operation count
  // rather than tracked as a separate axis, since §39 only asks for "an
  // estimated total model operations" figure alongside the per-category
  // breakdown above.
  const gptZeroCalls = run.enabledTests.some(t => t === 'A2H-01' || t === 'A2H-02' || t === 'A2H-03') ? cohort.length + normalTransformations : 0
  const estimatedTotalModelOperations = humaniteOperations + gptZeroCalls
    + (run.enabledTests.includes('A2H-07') ? repeatabilityTrials : 0)
    + (run.enabledTests.includes('A2H-15') ? candidateSelectionTrials : 0)

  return { normalTransformations, repairAttempts, repeatabilityTrials, styleToneTrials, genreAudienceTrials, candidateSelectionTrials, estimatedTotalModelOperations }
}

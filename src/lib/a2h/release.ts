import type { Firestore } from 'firebase-admin/firestore'
import { createHash } from 'crypto'
import { effectiveIntensity } from '@/lib/intensity'
import {
  A2H_COLLECTIONS, EXPERIMENTAL_TRIAL_TEST_CODES,
  type BenchmarkRun, type BenchmarkRelease, type ReleaseValidationResult, type A2HTestCode,
} from './types'
import { getRun, listRunSources, getRunProgress } from './runs'
import { getCorpusManifest } from './corpusProject'
import { getFixtureSet } from './fixtures'
import { listOutputsForRun } from './outputs'
import { listTestResultsForRun } from './testResults'
import { listTrialsForRun } from './trials'
import { listRepairAttemptsForRun } from './repairAttempts'
import { listJobsForRun } from './jobs'
import { listDetectorEvidenceForRun } from './baseline'
import { getExperimentCohort } from './experimentCohort'
import { getA2H01Report } from './a2h01'
import { getA2H02Report } from './a2h02'
import { getA2H03Report } from './a2h03'
import { getA2H04Report } from './a2h04'
import { getA2H05Report } from './a2h05'
import { getA2H06Report } from './a2h06'
import { getA2H07Report } from './a2h07'
import { getA2H08Report } from './a2h08'
import { getA2H09Report } from './a2h09'
import { getA2H10Report } from './a2h10'
import { getA2H11Report } from './a2h11'
import { getA2H12Report } from './a2h12'
import { getA2H13Report } from './a2h13'
import { getA2H14Report } from './a2h14'
import { getA2H15Report } from './a2h15'
import { getA2H16Report } from './a2h16'
import { getA2H17Report } from './a2h17'

const COLLECTION = A2H_COLLECTIONS.releases
export const DEFAULT_RELEASE_VERSION = 'RELEASE-V001'

// Codes whose test_evaluation job runs unconditionally against every
// successful output (§Phase 2/4) — even a fixture-backed test with zero
// fixture coverage for a source still writes an (eligible: false) result
// row for it, so coverage is always exactly `successfulOutputCount`.
const OUTPUT_SCOPED_CODES: readonly A2HTestCode[] = ['A2H-01', 'A2H-02', 'A2H-04', 'A2H-05', 'A2H-08', 'A2H-09', 'A2H-10', 'A2H-13', 'A2H-16']
// Pure aggregations with no result rows of their own — never a coverage gap.
const AGGREGATE_ONLY_CODES: readonly A2HTestCode[] = ['A2H-03', 'A2H-17']

// The full pre-release checklist. Deliberately errs toward MORE checks than
// strictly needed rather than fewer — a release is meant to be trustworthy
// enough that "we checked" isn't a matter of taste.
export async function validateReleaseReadiness(firestore: Firestore, runId: string): Promise<ReleaseValidationResult> {
  const errors: string[] = []
  const warnings: string[] = []

  const run = await getRun(firestore, runId)
  if (!run) {
    errors.push('Benchmark run not found.')
    return { ok: false, errors, warnings }
  }
  if (run.releasedAt) errors.push('This run already has a release — a corrected re-execution belongs in a new BenchmarkRun.')
  if (run.status !== 'completed') {
    errors.push(`Run must be 'completed' to release — currently '${run.status}'.${run.status === 'needs_attention' ? ' Retry its failed jobs first.' : ''}`)
  }

  // Corpus manifest still matches the run's own snapshot.
  const manifest = await getCorpusManifest(firestore, run.corpusProjectId)
  if (!manifest) errors.push('Corpus manifest not found.')
  else if (manifest.manifestHash !== run.corpusManifestHash) errors.push("The run's snapshotted corpus manifest hash no longer matches the corpus's current manifest.")

  // Run cohort — frozen at validation time, checked for internal consistency.
  const cohort = await listRunSources(firestore, runId)
  if (cohort.length === 0) errors.push('Run cohort is empty.')
  if (new Set(cohort.map(c => c.sourceId)).size !== cohort.length) errors.push('Duplicate sourceId found in the run cohort.')

  // Every expected primary output exists and succeeded; no duplicate
  // (sourceId, intensity) logical outputs.
  const outputs = await listOutputsForRun(firestore, runId)
  const expectedOutputCount = cohort.length * run.intensities.length
  const successfulOutputs = outputs.filter(o => o.status === 'success')
  if (successfulOutputs.length !== expectedOutputCount) {
    errors.push(`Expected ${expectedOutputCount} successful primary outputs (${cohort.length} sources x ${run.intensities.length} intensities); found ${successfulOutputs.length}.`)
  }
  const outputKeys = outputs.map(o => `${o.sourceId}__${o.intensity}`)
  if (new Set(outputKeys).size !== outputKeys.length) errors.push('Duplicate (sourceId, intensity) outputs detected.')

  // No queued/running/retrying jobs; no unresolved failures.
  const jobs = await listJobsForRun(firestore, runId)
  const unresolved = jobs.filter(j => j.status === 'queued' || j.status === 'running' || j.status === 'retrying')
  if (unresolved.length > 0) errors.push(`${unresolved.length} job(s) are still queued/running/retrying.`)
  const failedJobs = jobs.filter(j => j.status === 'failed')
  if (failedJobs.length > 0) errors.push(`${failedJobs.length} job(s) are unresolved failures — retry them before releasing.`)

  // Fixture version matches the run's own snapshot, and the set is still locked.
  if (run.fixtureSetId) {
    const fixtureSet = await getFixtureSet(firestore, run.fixtureSetId)
    if (!fixtureSet) errors.push('The fixture set referenced by this run no longer exists.')
    else {
      if (fixtureSet.status !== 'locked') errors.push(`The fixture set is ${fixtureSet.status}, not locked.`)
      if (fixtureSet.fixtureVersion !== run.fixtureVersion) errors.push("The fixture set's version no longer matches this run's snapshot.")
    }
  }

  // Every enabled required test has full result coverage. Output-scoped
  // tests always expect exactly one row per successful output; repair/trial
  // tests reuse getRunProgress's own (already-tested) totals.
  const testResults = await listTestResultsForRun(firestore, runId)
  for (const code of run.enabledTests) {
    if (AGGREGATE_ONLY_CODES.includes(code)) continue
    if (OUTPUT_SCOPED_CODES.includes(code)) {
      const count = testResults.filter(r => r.benchmarkCode === code).length
      if (count !== successfulOutputs.length) errors.push(`${code} has ${count}/${successfulOutputs.length} expected result rows.`)
    }
  }
  const progress = await getRunProgress(firestore, runId)
  for (const [code, total] of Object.entries(progress.repairJobsTotal) as [A2HTestCode, number][]) {
    const completed = progress.repairJobsCompleted[code] ?? 0
    if (completed !== total) errors.push(`${code} has ${completed}/${total} expected repair attempts.`)
  }
  for (const [code, total] of Object.entries(progress.trialJobsTotal) as [A2HTestCode, number][]) {
    const completed = progress.trialJobsCompleted[code] ?? 0
    if (completed !== total) errors.push(`${code} has ${completed}/${total} expected trials.`)
  }

  // Duplicate result identities — testResultId() is deterministic by
  // construction, but this checks the actual persisted rows rather than
  // trusting that invariant blindly.
  const resultKeys = testResults.map(r => `${r.outputId ?? r.fixtureId ?? 'none'}__${r.benchmarkCode}__${r.testVersion}`)
  if (new Set(resultKeys).size !== resultKeys.length) errors.push('Duplicate BenchmarkTestResult identity detected.')

  // Every enabled experimental test has its frozen cohort.
  for (const code of EXPERIMENTAL_TRIAL_TEST_CODES) {
    if (!run.enabledTests.includes(code)) continue
    const experimentCohort = await getExperimentCohort(firestore, runId, code)
    if (!experimentCohort) errors.push(`${code} is enabled but has no frozen experiment cohort.`)
  }

  // "Final Polish" patch, §13/§15: output configuration consistency. A
  // legacy run (no executionSemanticsVersion at all) predates
  // requestedIntensity/appliedIntensity/intensityCapped existing as real,
  // persisted fields — checking them would be meaningless, so this run is
  // instead checked ONLY for whether it touches a domain/intensity
  // combination the current cap would have applied to; if so, its outputs
  // may have bypassed production's domain intensity policy entirely (§1)
  // and it must not be released as-is.
  if (!run.executionSemanticsVersion) {
    const wouldHaveBeenCapped = successfulOutputs.some(o => effectiveIntensity(o.intensity, o.domainId).capped)
    if (wouldHaveBeenCapped) {
      errors.push(
        'This run predates product-faithful domain intensity caps. Create a new run before producing a final benchmark release.',
      )
    } else {
      warnings.push(
        "This run predates executionSemanticsVersion tracking — none of its domains/intensities would have been capped, but full product-fidelity cannot be verified for it.",
      )
    }
  } else {
    // A current-schema run: verify every successful output's model/
    // provider/intensity fields are actually internally consistent, not
    // just present — catches a mixed-model/provider run, or an intensity
    // cap drift between generation time and release time, before
    // publication. Aggregated into one message per category rather than
    // one per row, since a systemic issue could otherwise affect every
    // output in the run.
    const wrongRunId = successfulOutputs.filter(o => o.runId !== run.id).length
    if (wrongRunId > 0) errors.push(`${wrongRunId} output(s) have a runId that does not match this run.`)

    const wrongProvider = successfulOutputs.filter(o => o.modelProvider !== run.modelProvider).length
    if (wrongProvider > 0) {
      errors.push(`${wrongProvider} output(s) were generated under a different provider than this run's snapshot ('${run.modelProvider}') — release blocked to prevent mixed-provider evidence.`)
    }

    // Tolerates a provider-versioned suffix (e.g. requested 'gpt-4o-mini',
    // API reports 'gpt-4o-mini-2024-07-18') — a real, benign difference
    // between the requested model name and what a provider's response
    // reports, not a mixed-model run.
    const wrongModel = successfulOutputs.filter(o => o.model !== run.model && !o.model.startsWith(`${run.model}-`)).length
    if (wrongModel > 0) {
      errors.push(`${wrongModel} output(s) were generated under a different model than this run's snapshot ('${run.model}') — release blocked to prevent mixed-model evidence.`)
    }

    const badRequested = successfulOutputs.filter(o => o.requestedIntensity !== o.intensity).length
    if (badRequested > 0) errors.push(`${badRequested} output(s) have a requestedIntensity that does not match their own intensity field.`)

    const badApplied = successfulOutputs.filter(o => {
      const expected = effectiveIntensity(o.requestedIntensity, o.domainId)
      return o.appliedIntensity !== expected.applied || o.intensityCapped !== expected.capped
    }).length
    if (badApplied > 0) {
      errors.push(`${badApplied} output(s) have an appliedIntensity/intensityCapped value inconsistent with the current effective-intensity policy for their domain.`)
    }
  }

  return { ok: errors.length === 0, errors, warnings }
}

// Sha256 of every row's own content, sorted by id for a stable hash
// regardless of read order — used both for outputHashes/resultHashes and
// for the whole-release releaseHash.
function hashRows(rows: Array<{ id: string }>): string {
  const sorted = [...rows].sort((a, b) => a.id.localeCompare(b.id))
  return createHash('sha256').update(JSON.stringify(sorted)).digest('hex')
}

export async function computeAggregateSnapshot(firestore: Firestore, run: BenchmarkRun): Promise<Record<string, unknown>> {
  const snapshot: Record<string, unknown> = {}
  for (const code of run.enabledTests) {
    switch (code) {
      case 'A2H-01': snapshot[code] = await getA2H01Report(firestore, run.id); break
      case 'A2H-02': snapshot[code] = await getA2H02Report(firestore, run.id); break
      case 'A2H-03': snapshot[code] = await getA2H03Report(firestore, run.id); break
      case 'A2H-04': snapshot[code] = await getA2H04Report(firestore, run.id); break
      case 'A2H-05': snapshot[code] = await getA2H05Report(firestore, run.id); break
      case 'A2H-06': snapshot[code] = await getA2H06Report(firestore, run.id); break
      case 'A2H-07': snapshot[code] = await getA2H07Report(firestore, run.id); break
      case 'A2H-08': snapshot[code] = await getA2H08Report(firestore, run.id); break
      case 'A2H-09': snapshot[code] = await getA2H09Report(firestore, run.id); break
      case 'A2H-10': snapshot[code] = await getA2H10Report(firestore, run.id); break
      case 'A2H-11': snapshot[code] = await getA2H11Report(firestore, run.id, run.experimentConfig?.styleTone?.contrasts ?? []); break
      case 'A2H-12': snapshot[code] = await getA2H12Report(firestore, run.id); break
      case 'A2H-13': snapshot[code] = await getA2H13Report(firestore, run.id); break
      case 'A2H-14': snapshot[code] = await getA2H14Report(firestore, run.id, run.experimentConfig?.genreAudience?.contrasts ?? []); break
      case 'A2H-15': snapshot[code] = await getA2H15Report(firestore, run.id, run); break
      case 'A2H-16': snapshot[code] = await getA2H16Report(firestore, run.id); break
      case 'A2H-17': snapshot[code] = await getA2H17Report(firestore, run.id); break
    }
  }
  return snapshot
}

export async function getRelease(firestore: Firestore, id: string): Promise<BenchmarkRelease | null> {
  const doc = await firestore.collection(COLLECTION).doc(id).get()
  return doc.exists ? (doc.data() as BenchmarkRelease) : null
}

export async function getReleaseForRun(firestore: Firestore, runId: string): Promise<BenchmarkRelease | null> {
  const snap = await firestore.collection(COLLECTION).where('runId', '==', runId).get()
  const docs = snap.docs.map(d => d.data() as BenchmarkRelease)
  return docs[0] ?? null
}

export interface CreateReleaseResult {
  ok: boolean
  errors: string[]
  release: BenchmarkRelease | null
}

// Freezes a BenchmarkRelease for a run — only ever succeeds after
// validateReleaseReadiness passes, and only ever runs once per run (a
// second call for an already-released run fails the same readiness check
// that flags releasedAt). Never mutated afterward; a correction is a new
// BenchmarkRun and a new release.
export async function createRelease(firestore: Firestore, runId: string): Promise<CreateReleaseResult> {
  const readiness = await validateReleaseReadiness(firestore, runId)
  if (!readiness.ok) return { ok: false, errors: readiness.errors, release: null }

  const run = (await getRun(firestore, runId))!
  const [outputs, testResults, trials, repairAttempts, jobs, detectorEvidence] = await Promise.all([
    listOutputsForRun(firestore, runId),
    listTestResultsForRun(firestore, runId),
    listTrialsForRun(firestore, runId),
    listRepairAttemptsForRun(firestore, runId),
    listJobsForRun(firestore, runId),
    listDetectorEvidenceForRun(firestore, run),
  ])
  const manifest = (await getCorpusManifest(firestore, run.corpusProjectId))!

  const aggregateSnapshot = await computeAggregateSnapshot(firestore, run)
  const outputHashes: Record<string, string> = { outputs: hashRows(outputs) }
  // §12 of the "Final Polish" patch: A2H-01/A2H-02 fundamentally depend on
  // detector evidence (baselines + post-scores) — a release that hashes
  // only outputs/results/trials/repair-attempts could have its underlying
  // GPTZero rows silently change or vanish without integrity verification
  // ever noticing. detectorResults uses the LOGICAL definition
  // (listDetectorEvidenceForRun), never a stored runId filter, so a reused
  // cross-run baseline is covered too.
  const resultHashes: Record<string, string> = {
    detectorResults: hashRows(detectorEvidence),
    testResults: hashRows(testResults),
    trials: hashRows(trials),
    repairAttempts: hashRows(repairAttempts),
  }

  const now = new Date().toISOString()
  const ref = firestore.collection(COLLECTION).doc()
  const releaseWithoutHash: Omit<BenchmarkRelease, 'releaseHash'> = {
    id: ref.id,
    runId: run.id,
    corpusProjectId: run.corpusProjectId,
    releaseVersion: DEFAULT_RELEASE_VERSION,
    benchmarkVersion: run.benchmarkVersion,
    testVersion: run.testVersion,
    corpusManifestHash: manifest.manifestHash,
    fixtureSetId: run.fixtureSetId,
    fixtureVersion: run.fixtureVersion,
    humaniteVersion: run.humaniteVersion,
    gitCommit: run.gitCommit,
    modelProvider: run.modelProvider,
    model: run.model,
    enabledTests: run.enabledTests,
    sourceCount: (await listRunSources(firestore, runId)).length,
    primaryOutputCount: outputs.filter(o => o.status === 'success').length,
    trialCount: trials.length,
    repairAttemptCount: repairAttempts.length,
    testResultCount: testResults.length,
    failedJobCount: jobs.filter(j => j.status === 'failed').length,
    excludedRecordCount: outputs.filter(o => o.status !== 'success').length,
    outputHashes,
    resultHashes,
    aggregateSnapshot,
    completedAt: run.completedAt ?? now,
    releasedAt: now,
  }
  const releaseHash = createHash('sha256').update(JSON.stringify(releaseWithoutHash)).digest('hex')
  const release: BenchmarkRelease = { ...releaseWithoutHash, releaseHash }

  await ref.set(release)
  await firestore.collection(A2H_COLLECTIONS.runs).doc(runId).update({ releasedAt: now, updatedAt: now })

  return { ok: true, errors: [], release }
}

export interface ReleaseIntegrityResult {
  ok: boolean
  errors: string[]
}

// Recomputes every stored hash from the CURRENT raw records and compares —
// "stored hashes recompute correctly." A released run's records are never
// mutated by this codebase, so a mismatch here means either an
// out-of-band data change or a genuine bug, either of which an admin needs
// to know about before trusting this release's published numbers.
export async function verifyReleaseIntegrity(firestore: Firestore, releaseId: string): Promise<ReleaseIntegrityResult> {
  const release = await getRelease(firestore, releaseId)
  if (!release) return { ok: false, errors: ['Release not found.'] }
  const run = await getRun(firestore, release.runId)
  if (!run) return { ok: false, errors: ['The released run no longer exists.'] }

  const errors: string[] = []
  const [outputs, testResults, trials, repairAttempts, detectorEvidence] = await Promise.all([
    listOutputsForRun(firestore, release.runId),
    listTestResultsForRun(firestore, release.runId),
    listTrialsForRun(firestore, release.runId),
    listRepairAttemptsForRun(firestore, release.runId),
    listDetectorEvidenceForRun(firestore, run),
  ])

  if (hashRows(outputs) !== release.outputHashes['outputs']) errors.push('outputs hash no longer matches stored records.')
  if (hashRows(detectorEvidence) !== release.resultHashes['detectorResults']) errors.push('detectorResults hash no longer matches stored records.')
  if (hashRows(testResults) !== release.resultHashes['testResults']) errors.push('testResults hash no longer matches stored records.')
  if (hashRows(trials) !== release.resultHashes['trials']) errors.push('trials hash no longer matches stored records.')
  if (hashRows(repairAttempts) !== release.resultHashes['repairAttempts']) errors.push('repairAttempts hash no longer matches stored records.')

  return { ok: errors.length === 0, errors }
}

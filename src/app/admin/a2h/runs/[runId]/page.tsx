'use client'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { DOMAINS, type Domain } from '@/lib/style/types'
import { A2H_TEST_LABELS, IMPLEMENTED_A2H_TESTS, FIXTURE_REQUIRING_TESTS, type A2HTestCode } from '@/lib/a2h/types'
import {
  apiGetRun, apiGetProject, apiListTopics, apiUpdateRunDraft, apiValidateRun,
  apiStartRun, apiPauseRun, apiResumeRun, apiCancelRun, apiGetRunProgress, apiExecuteRunBatch,
  apiListFixtureSets, type FixtureSet, type FixtureTestEligibility,
  type BenchmarkRun, type CorpusProject, type BenchmarkTopic, type RunValidationResult, type RunProgress, type RunWorkEstimate,
} from '@/lib/a2hApi'
import { Spinner } from '@/components/ui/Spinner'

// §44: presented in NUMERICAL order, not implementation order — IMPLEMENTED_A2H_TESTS
// itself is ordered by when each phase shipped, so this page sorts by the
// numeric suffix for display purposes only.
const ALL_TESTS: A2HTestCode[] = [...IMPLEMENTED_A2H_TESTS].sort((a, b) => Number(a.slice(4)) - Number(b.slice(4)))
const TEST_LABEL = A2H_TEST_LABELS

type TestDisplayStatus = 'not_eligible' | 'not_started' | 'running' | 'complete' | 'failed'

// A coarse but honest status per test (§44): "not eligible" means this run
// doesn't have the test enabled; "failed" only reflects a whole-run failure,
// since RunProgress's failedJobs count isn't broken down per test code.
// Every other test infers progress from the same RunProgress fields the
// page's own Progress section already reads.
function testDisplayStatus(run: BenchmarkRun, progress: RunProgress | null, code: A2HTestCode): TestDisplayStatus {
  if (!run.enabledTests.includes(code)) return 'not_eligible'
  if (run.status === 'failed') return 'failed'
  if (run.status === 'draft' || run.status === 'validated') return 'not_started'
  if (!progress) return 'not_started'

  let completed = 0
  let total = 0
  if (code === 'A2H-01') { completed = progress.a2h01ResultsCompleted; total = progress.outputsTotal }
  else if (code === 'A2H-02') { completed = progress.a2h02ResultsCompleted; total = progress.outputsTotal }
  else if (code === 'A2H-03' || code === 'A2H-17') { completed = progress.outputsCompleted; total = progress.outputsTotal }
  else if (code === 'A2H-08') { completed = progress.outputsCompleted; total = progress.outputsTotal }
  else if (code === 'A2H-06' || code === 'A2H-12') { completed = progress.repairJobsCompleted[code] ?? 0; total = progress.repairJobsTotal[code] ?? 0 }
  else if (code === 'A2H-07' || code === 'A2H-11' || code === 'A2H-14' || code === 'A2H-15') { completed = progress.trialJobsCompleted[code] ?? 0; total = progress.trialJobsTotal[code] ?? 0 }
  else { completed = progress.deterministicResultsCompleted[code] ?? 0; total = progress.outputsTotal }

  if (total === 0) return 'not_started'
  if (completed >= total) return 'complete'
  return 'running'
}

const STATUS_LABEL: Record<TestDisplayStatus, string> = {
  not_eligible: 'Not eligible', not_started: 'Not started', running: 'Running', complete: 'Complete', failed: 'Failed',
}
const STATUS_CLASS: Record<TestDisplayStatus, string> = {
  not_eligible: 'text-gray-400 dark:text-gray-600',
  not_started: 'text-gray-500 dark:text-gray-400',
  running: 'text-amber-600 dark:text-amber-400',
  complete: 'text-green-700 dark:text-green-400',
  failed: 'text-red-600 dark:text-red-400',
}

export default function A2HRunDetailPage() {
  const runId = useParams().runId as string

  const [run, setRun] = useState<BenchmarkRun | null>(null)
  const [project, setProject] = useState<CorpusProject | null>(null)
  const [topics, setTopics] = useState<BenchmarkTopic[]>([])
  const [progress, setProgress] = useState<RunProgress | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [validation, setValidation] = useState<RunValidationResult | null>(null)
  const [eligibility, setEligibility] = useState<Partial<Record<A2HTestCode, FixtureTestEligibility>>>({})
  const [workEstimate, setWorkEstimate] = useState<RunWorkEstimate | null>(null)
  const [fixtureSets, setFixtureSets] = useState<FixtureSet[]>([])
  const [runningAll, setRunningAll] = useState(false)

  const refresh = useCallback(async () => {
    const r = await apiGetRun(runId)
    setRun(r)
    if (r.status !== 'draft') {
      setProgress(await apiGetRunProgress(runId))
    }
    return r
  }, [runId])

  useEffect(() => {
    let cancelled = false
    apiGetRun(runId)
      .then(async r => {
        if (cancelled) return
        setRun(r)
        const [p, t, fs] = await Promise.all([apiGetProject(r.corpusProjectId), apiListTopics(r.corpusProjectId), apiListFixtureSets(r.corpusProjectId)])
        if (cancelled) return
        setProject(p)
        setTopics(t)
        setFixtureSets(fs)
        if (r.status !== 'draft') setProgress(await apiGetRunProgress(runId))
      })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load run.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [runId])

  const isDraft = run?.status === 'draft'

  function toggleDomain(d: Domain) {
    if (!run) return
    const selected = run.selectedDomains.includes(d)
    const nextDomains = selected ? run.selectedDomains.filter(x => x !== d) : [...run.selectedDomains, d]
    const domainTopicIds = topics.filter(t => t.domainId === d).map(t => t.id)
    const nextTopicIds = selected
      ? run.selectedTopicIds.filter(id => !domainTopicIds.includes(id))
      : [...new Set([...run.selectedTopicIds, ...domainTopicIds])]
    setRun({ ...run, selectedDomains: nextDomains, selectedTopicIds: nextTopicIds })
  }

  function toggleLength(len: number) {
    if (!run) return
    const next = run.selectedLengths.includes(len) ? run.selectedLengths.filter(l => l !== len) : [...run.selectedLengths, len].sort((a, b) => a - b)
    setRun({ ...run, selectedLengths: next })
  }

  function toggleIntensity(i: number) {
    if (!run) return
    const next = run.intensities.includes(i) ? run.intensities.filter(x => x !== i) : [...run.intensities, i].sort((a, b) => a - b)
    setRun({ ...run, intensities: next })
  }

  function toggleTest(code: A2HTestCode) {
    if (!run) return
    const next = run.enabledTests.includes(code) ? run.enabledTests.filter(t => t !== code) : [...run.enabledTests, code]
    setRun({ ...run, enabledTests: next })
  }

  async function handleSaveDraft() {
    if (!run) return
    setBusy(true)
    setError(null)
    try {
      const updated = await apiUpdateRunDraft(run.id, {
        selectedDomains: run.selectedDomains,
        selectedTopicIds: run.selectedTopicIds,
        selectedLengths: run.selectedLengths,
        intensities: run.intensities,
        enabledTests: run.enabledTests,
        fixtureSetId: run.fixtureSetId,
      })
      setRun(updated)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.')
    } finally {
      setBusy(false)
    }
  }

  async function handleValidate() {
    if (!run) return
    setBusy(true)
    setError(null)
    try {
      const { run: updated, result, eligibility: nextEligibility, workEstimate: nextWorkEstimate } = await apiValidateRun(run.id)
      setRun(updated)
      setValidation(result)
      setEligibility(nextEligibility as Partial<Record<A2HTestCode, FixtureTestEligibility>>)
      setWorkEstimate(nextWorkEstimate)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Validation failed.')
    } finally {
      setBusy(false)
    }
  }

  async function handleStart() {
    if (!run) return
    setBusy(true)
    setError(null)
    try {
      setRun(await apiStartRun(run.id))
      setProgress(await apiGetRunProgress(run.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Start failed.')
    } finally {
      setBusy(false)
    }
  }

  async function handlePause() {
    if (!run) return
    setBusy(true)
    try {
      setRun(await apiPauseRun(run.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Pause failed.')
    } finally {
      setBusy(false)
    }
  }

  async function handleResume() {
    if (!run) return
    setBusy(true)
    try {
      setRun(await apiResumeRun(run.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Resume failed.')
    } finally {
      setBusy(false)
    }
  }

  async function handleCancel() {
    if (!run) return
    if (!window.confirm('Cancel this run? Queued work is dropped; already-completed results are kept.')) return
    setBusy(true)
    try {
      setRun(await apiCancelRun(run.id))
      setProgress(await apiGetRunProgress(run.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cancel failed.')
    } finally {
      setBusy(false)
    }
  }

  // Loops apiExecuteRunBatch — the interactive equivalent of a worker
  // picking jobs off a queue, since this deployment has no background
  // worker process. Stops when the run leaves 'running' (paused, completed,
  // or cancelled elsewhere) or on any error.
  async function handleRunAll() {
    if (!run) return
    setRunningAll(true)
    setError(null)
    try {
      for (let i = 0; i < 2000; i++) {
        const result = await apiExecuteRunBatch(run.id)
        setProgress(await apiGetRunProgress(run.id))
        if (result.run.status !== 'running') {
          setRun(result.run)
          break
        }
        setRun(result.run)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Execution failed.')
    } finally {
      setRunningAll(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-white dark:bg-gray-950 flex items-center justify-center">
        <Spinner className="w-6 h-6 border-gray-200 border-t-gray-700 dark:border-gray-700 dark:border-t-gray-300" />
      </div>
    )
  }
  if (!run) {
    return <div className="min-h-screen bg-white dark:bg-gray-950 p-6 text-sm text-gray-400 dark:text-gray-500">Run not found.</div>
  }

  const expectedSources = run.selectedTopicIds.length * run.selectedLengths.length
  const expectedTransforms = expectedSources * run.intensities.length

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950 p-6">
      <div className="max-w-3xl mx-auto space-y-5">
        <div>
          <Link href={`/admin/a2h/benchmark?project=${run.corpusProjectId}`} className="text-xs text-gray-400 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-300">← {project?.name ?? 'Benchmark Runs'}</Link>
          <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mt-1">{run.name}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {run.status} · {run.model} · manifest {run.corpusManifestHash.slice(0, 8)}…
          </p>
        </div>

        {error && <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-xl px-4 py-2.5">{error}</div>}

        {validation && !validation.ok && (
          <div className="text-sm text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-xl px-4 py-3 space-y-1">
            <p className="font-medium">Validation failed:</p>
            {validation.errors.map((e, i) => <p key={i}>• {e}</p>)}
          </div>
        )}

        <div className="border border-gray-200 dark:border-gray-800 rounded-2xl p-4 space-y-3">
          <h2 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Domains</h2>
          <div className="flex flex-wrap gap-1.5">
            {project?.domains.map(d => (
              <button key={d} onClick={() => isDraft && toggleDomain(d)} disabled={!isDraft}
                className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors capitalize disabled:cursor-default ${
                  run.selectedDomains.includes(d)
                    ? 'border-gray-900 bg-gray-900 text-white dark:border-gray-100 dark:bg-gray-100 dark:text-gray-900'
                    : 'border-gray-200 text-gray-400 dark:border-gray-700 dark:text-gray-600'
                }`}>
                {d}
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-400 dark:text-gray-500">{run.selectedTopicIds.length} topics selected</p>
        </div>

        <div className="border border-gray-200 dark:border-gray-800 rounded-2xl p-4 space-y-3">
          <h2 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Lengths</h2>
          <div className="flex flex-wrap gap-1.5">
            {project?.lengthLadder.map(len => (
              <button key={len} onClick={() => isDraft && toggleLength(len)} disabled={!isDraft}
                className={`text-xs font-medium px-2.5 py-1.5 rounded-lg border transition-colors disabled:cursor-default ${
                  run.selectedLengths.includes(len)
                    ? 'border-gray-900 bg-gray-900 text-white dark:border-gray-100 dark:bg-gray-100 dark:text-gray-900'
                    : 'border-gray-200 text-gray-400 dark:border-gray-700 dark:text-gray-600'
                }`}>
                {len}
              </button>
            ))}
          </div>
        </div>

        <div className="border border-gray-200 dark:border-gray-800 rounded-2xl p-4 space-y-3">
          <h2 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Intensities</h2>
          <div className="flex flex-wrap gap-1.5">
            {Array.from({ length: 10 }, (_, i) => i + 1).map(i => (
              <button key={i} onClick={() => isDraft && toggleIntensity(i)} disabled={!isDraft}
                className={`w-8 h-8 rounded-lg text-xs font-semibold transition-colors disabled:cursor-default ${
                  run.intensities.includes(i)
                    ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
                    : 'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-600'
                }`}>
                {i}
              </button>
            ))}
          </div>
        </div>

        <div className="border border-gray-200 dark:border-gray-800 rounded-2xl p-4 space-y-2">
          <h2 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Tests</h2>
          {ALL_TESTS.map(code => (
            <label key={code} className={`flex items-center gap-2 text-sm ${isDraft ? 'text-gray-700 dark:text-gray-300' : 'text-gray-400 dark:text-gray-600'}`}>
              <input type="checkbox" checked={run.enabledTests.includes(code)} disabled={!isDraft} onChange={() => toggleTest(code)} />
              {TEST_LABEL[code]}
            </label>
          ))}
        </div>

        {run.enabledTests.some(t => FIXTURE_REQUIRING_TESTS.includes(t)) && (
          <div className="border border-gray-200 dark:border-gray-800 rounded-2xl p-4 space-y-2">
            <h2 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Fixture Set</h2>
            <p className="text-xs text-gray-400 dark:text-gray-500">Required — a locked fixture set to back A2H-04/05/09/10/13.</p>
            {isDraft ? (
              <select
                value={run.fixtureSetId ?? ''}
                onChange={e => setRun({ ...run, fixtureSetId: e.target.value || null })}
                className="w-full text-sm rounded-xl px-3 py-2 bg-white border border-gray-300 text-gray-700 dark:bg-gray-900 dark:border-gray-700 dark:text-gray-300"
              >
                <option value="">Select a fixture set…</option>
                {fixtureSets.map(fs => (
                  <option key={fs.id} value={fs.id} disabled={fs.status !== 'locked'}>
                    {fs.name} · {fs.fixtureVersion} · {fs.status}{fs.status !== 'locked' ? ' (not locked)' : ''}
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-sm text-gray-700 dark:text-gray-300">{run.fixtureVersion ?? 'none snapshotted'}</p>
            )}
            {fixtureSets.length === 0 && (
              <Link href={`/admin/a2h/fixtures?project=${run.corpusProjectId}`} className="text-xs underline text-gray-500 dark:text-gray-400">
                No fixture sets yet — create one →
              </Link>
            )}
            {Object.keys(eligibility).length > 0 && (
              <dl className="space-y-1 text-xs pt-2 border-t border-gray-100 dark:border-gray-900">
                {(Object.entries(eligibility) as [string, FixtureTestEligibility][]).map(([code, e]) => (
                  <div key={code} className="flex justify-between">
                    <dt className="text-gray-500 dark:text-gray-400">{code} eligible outputs</dt>
                    <dd className="tabular-nums text-gray-700 dark:text-gray-300">{e.eligibleOutputCount.toLocaleString()} / {e.totalOutputCount.toLocaleString()}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        )}

        <div className="border border-gray-200 dark:border-gray-800 rounded-2xl p-4">
          <h2 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">Estimated</h2>
          <dl className="space-y-1 text-sm">
            <div className="flex justify-between"><dt className="text-gray-500 dark:text-gray-400">Source count</dt><dd className="tabular-nums text-gray-800 dark:text-gray-200 font-semibold">{expectedSources.toLocaleString()}</dd></div>
            <div className="flex justify-between"><dt className="text-gray-500 dark:text-gray-400">Transformations</dt><dd className="tabular-nums text-gray-800 dark:text-gray-200 font-semibold">{expectedTransforms.toLocaleString()}</dd></div>
          </dl>
        </div>

        {isDraft && (
          <div className="flex items-center gap-2">
            <button onClick={handleSaveDraft} disabled={busy}
              className="text-xs font-medium px-3.5 py-2 rounded-xl border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 disabled:opacity-40">
              {busy ? 'Saving…' : 'Save Draft'}
            </button>
            <button onClick={handleValidate} disabled={busy}
              className="text-xs font-medium px-3.5 py-2 rounded-xl bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900 disabled:opacity-40">
              {busy ? 'Validating…' : 'Validate Configuration'}
            </button>
          </div>
        )}

        {workEstimate && run.status === 'validated' && (
          <div className="border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-900/20 rounded-2xl p-4 space-y-1.5">
            <h2 className="text-xs font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wider mb-1">Estimated Paid Work (§39) — review before starting</h2>
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between"><dt className="text-gray-600 dark:text-gray-400">Normal transformations</dt><dd className="tabular-nums font-semibold">{workEstimate.normalTransformations.toLocaleString()}</dd></div>
              <div className="flex justify-between"><dt className="text-gray-600 dark:text-gray-400">Repair attempts (A2H-06/12)</dt><dd className="tabular-nums font-semibold">{workEstimate.repairAttempts.toLocaleString()}</dd></div>
              <div className="flex justify-between"><dt className="text-gray-600 dark:text-gray-400">Repeatability trials (A2H-07)</dt><dd className="tabular-nums font-semibold">{workEstimate.repeatabilityTrials.toLocaleString()}</dd></div>
              <div className="flex justify-between"><dt className="text-gray-600 dark:text-gray-400">Style/tone trials (A2H-11)</dt><dd className="tabular-nums font-semibold">{workEstimate.styleToneTrials.toLocaleString()}</dd></div>
              <div className="flex justify-between"><dt className="text-gray-600 dark:text-gray-400">Genre/audience trials (A2H-14)</dt><dd className="tabular-nums font-semibold">{workEstimate.genreAudienceTrials.toLocaleString()}</dd></div>
              <div className="flex justify-between"><dt className="text-gray-600 dark:text-gray-400">Candidate-selection trials (A2H-15)</dt><dd className="tabular-nums font-semibold">{workEstimate.candidateSelectionTrials.toLocaleString()}</dd></div>
              <div className="flex justify-between pt-1 border-t border-amber-200 dark:border-amber-900"><dt className="text-gray-700 dark:text-gray-300 font-medium">Estimated total model operations</dt><dd className="tabular-nums font-bold">{workEstimate.estimatedTotalModelOperations.toLocaleString()}</dd></div>
            </dl>
          </div>
        )}

        {run.status === 'validated' && (
          <button onClick={handleStart} disabled={busy}
            className="text-xs font-medium px-3.5 py-2 rounded-xl bg-green-600 text-white disabled:opacity-40">
            {busy ? 'Starting…' : 'Start Run'}
          </button>
        )}

        {(run.status === 'running' || run.status === 'paused') && (
          <div className="flex items-center gap-2">
            {run.status === 'running' && (
              <>
                <button onClick={handleRunAll} disabled={runningAll}
                  className="text-xs font-medium px-3.5 py-2 rounded-xl bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900 disabled:opacity-40">
                  {runningAll ? 'Running…' : 'Run All'}
                </button>
                <button onClick={handlePause} disabled={busy || runningAll}
                  className="text-xs font-medium px-3.5 py-2 rounded-xl border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 disabled:opacity-40">
                  Pause
                </button>
              </>
            )}
            {run.status === 'paused' && (
              <button onClick={handleResume} disabled={busy}
                className="text-xs font-medium px-3.5 py-2 rounded-xl bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900 disabled:opacity-40">
                Resume
              </button>
            )}
            <button onClick={handleCancel} disabled={busy || runningAll}
              className="text-xs font-medium px-3.5 py-2 rounded-xl border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 disabled:opacity-40">
              Cancel
            </button>
          </div>
        )}

        {progress && (
          <div className="border border-gray-200 dark:border-gray-800 rounded-2xl p-4 space-y-1.5">
            <h2 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1">Progress</h2>
            <ProgressRow label="Sources" value={progress.sources} total={progress.sources} />
            <ProgressRow label="GPTZero baselines" value={progress.baselinesCompleted} total={progress.baselinesTotal} />
            <ProgressRow label="Humanite outputs" value={progress.outputsCompleted} total={progress.outputsTotal} />
            <ProgressRow label="Post GPTZero" value={progress.postScoresCompleted} total={progress.postScoresTotal} />
            <ProgressRow label="A2H-01 results" value={progress.a2h01ResultsCompleted} total={run.enabledTests.includes('A2H-01') ? progress.outputsTotal : 0} />
            <ProgressRow label="A2H-02 results" value={progress.a2h02ResultsCompleted} total={run.enabledTests.includes('A2H-02') ? progress.outputsTotal : 0} />
            {run.enabledTests.includes('A2H-03') && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500 dark:text-gray-400">A2H-03</span>
                <span className="text-gray-400 dark:text-gray-500">Derived after results</span>
              </div>
            )}
            <div className="flex items-center justify-between text-sm pt-1 border-t border-gray-100 dark:border-gray-900 mt-1">
              <span className="text-gray-500 dark:text-gray-400">Failed jobs</span>
              <span className={progress.failedJobs > 0 ? 'text-red-600 dark:text-red-400 font-medium' : 'text-gray-700 dark:text-gray-300'}>{progress.failedJobs}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-500 dark:text-gray-400">Queued jobs</span>
              <span className="text-gray-700 dark:text-gray-300">{progress.queuedJobs}</span>
            </div>
          </div>
        )}

        {(run.status === 'running' || run.status === 'completed' || run.status === 'paused' || run.status === 'failed') && (
          <div className="border border-gray-200 dark:border-gray-800 rounded-2xl p-4 space-y-1.5">
            <h2 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1">Results (numerical order)</h2>
            {ALL_TESTS.filter(code => run.enabledTests.includes(code)).map(code => {
              const status = testDisplayStatus(run, progress, code)
              return (
                <Link key={code} href={`/admin/a2h/runs/${run.id}/tests/${code.toLowerCase()}`}
                  className="flex items-center gap-3 text-sm px-2 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-900/50 transition-colors">
                  <span className="w-16 shrink-0 font-medium text-gray-800 dark:text-gray-200">{code}</span>
                  <span className="flex-1 text-gray-500 dark:text-gray-400 truncate">{TEST_LABEL[code]}</span>
                  <span className={`text-xs font-medium ${STATUS_CLASS[status]}`}>{STATUS_LABEL[status]}</span>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function ProgressRow({ label, value, total }: { label: string; value: number; total: number }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-gray-500 dark:text-gray-400">{label}</span>
      <span className={`tabular-nums ${total > 0 && value === total ? 'text-green-700 dark:text-green-400' : 'text-gray-700 dark:text-gray-300'}`}>{value.toLocaleString()} / {total.toLocaleString()}</span>
    </div>
  )
}

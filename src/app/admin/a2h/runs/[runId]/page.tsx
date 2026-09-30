'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { DOMAINS, type Domain } from '@/lib/style/types'
import { A2H_TEST_LABELS, IMPLEMENTED_A2H_TESTS, FIXTURE_REQUIRING_TESTS, type A2HTestCode } from '@/lib/a2h/types'
import {
  apiGetRun, apiGetProject, apiListTopics, apiUpdateRunDraft, apiValidateRun,
  apiStartRun, apiPauseRun, apiResumeRun, apiRecoverRun, apiCancelRun, apiGetRunProgress, apiExecuteRunBatch,
  apiListFixtureSets, type FixtureSet, type FixtureTestEligibility,
  apiRetryFailedJobs, apiGetReleaseReadiness, apiCreateRelease, apiVerifyReleaseIntegrity, apiDownloadExportFile,
  EXPORT_FILE_NAMES, type ExportFileName, type ReleaseReadiness, type RecoverySummary,
  type BenchmarkRun, type CorpusProject, type BenchmarkTopic, type RunValidationResult, type RunProgress, type RunWorkEstimate,
} from '@/lib/a2hApi'
import { Spinner } from '@/components/ui/Spinner'

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// §50 of the Phase 5A spec: keep the browser's Run All loop moving briskly
// while progress is being made, back off when there's genuinely nothing to
// do, and never sleep longer than this between checks so a Pause click is
// noticed promptly even while waiting out a retry backoff window.
const ACTIVE_POLL_MS = 300
const IDLE_POLL_MS = 1000
const MAX_RETRY_WAIT_MS = 5000
// §52: after this many consecutive empty, non-retrying polls, stop rather
// than spin forever — something needs a human look (recovery, most likely).
const MAX_CONSECUTIVE_NO_PROGRESS = 4

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
  const [releaseInfo, setReleaseInfo] = useState<ReleaseReadiness | null>(null)
  const [integrityResult, setIntegrityResult] = useState<{ ok: boolean; errors: string[] } | null>(null)
  // Phase 5A: the browser loop's own cancellation signal — set immediately
  // on a Pause click so the loop stops requesting new batches without
  // waiting for a round-trip race against the in-flight one (§20-22).
  const cancelRequestedRef = useRef(false)
  const [resumeFeedback, setResumeFeedback] = useState<RecoverySummary | null>(null)
  const [recoverFeedback, setRecoverFeedback] = useState<RecoverySummary | null>(null)
  const [runAllNotice, setRunAllNotice] = useState<string | null>(null)

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

  // §20-22: signals the Run All loop to stop BEFORE the server call even
  // resolves — the loop checks this flag at the top of every iteration —
  // and only then asks the server to pause. Already-claimed jobs finish and
  // checkpoint normally; this never cancels an in-flight request.
  async function handlePause() {
    if (!run) return
    cancelRequestedRef.current = true
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
    setResumeFeedback(null)
    try {
      const { run: updated, recovery } = await apiResumeRun(run.id)
      setRun(updated)
      setResumeFeedback(recovery)
      setProgress(await apiGetRunProgress(run.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Resume failed.')
    } finally {
      setBusy(false)
    }
  }

  // §19: reconciles stale/interrupted jobs WITHOUT changing the run's own
  // status — available for a paused, needs_attention, or running run so an
  // admin can force reconciliation (after a crash, network outage, or
  // deployment) before deciding what to do next.
  async function handleRecover() {
    if (!run) return
    setBusy(true)
    setRecoverFeedback(null)
    try {
      const { run: updated, recovery } = await apiRecoverRun(run.id)
      setRun(updated)
      setRecoverFeedback(recovery)
      setProgress(await apiGetRunProgress(run.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Recovery failed.')
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

  async function handleRetryFailedJobs() {
    if (!run) return
    setBusy(true)
    setError(null)
    try {
      const { run: updated, retriedCount, reconciledCount } = await apiRetryFailedJobs(run.id)
      setRun(updated)
      setProgress(await apiGetRunProgress(run.id))
      if (reconciledCount > 0) {
        setRunAllNotice(`${reconciledCount} failed job(s) already had valid evidence and were marked completed without retrying; ${retriedCount} were requeued.`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Retry failed.')
    } finally {
      setBusy(false)
    }
  }

  const loadReleaseInfo = useCallback(async () => {
    if (!run) return
    try {
      setReleaseInfo(await apiGetReleaseReadiness(run.id))
    } catch {
      // Non-fatal — the release panel simply stays hidden/empty.
    }
  }, [run])

  useEffect(() => {
    if (run && (run.status === 'completed' || run.status === 'needs_attention')) void loadReleaseInfo()
  }, [run, loadReleaseInfo])

  async function handleFreezeRelease() {
    if (!run) return
    if (!window.confirm('Freeze this benchmark release? Once frozen, this run\'s evidence can never be regenerated or overwritten.')) return
    setBusy(true)
    setError(null)
    try {
      const result = await apiCreateRelease(run.id)
      if (!result.ok) {
        setError(`Release blocked: ${result.errors.join(' ')}`)
      } else {
        await loadReleaseInfo()
        setRun(await apiGetRun(run.id))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Release failed.')
    } finally {
      setBusy(false)
    }
  }

  async function handleVerifyIntegrity() {
    if (!run) return
    setBusy(true)
    setError(null)
    try {
      setIntegrityResult(await apiVerifyReleaseIntegrity(run.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Integrity check failed.')
    } finally {
      setBusy(false)
    }
  }

  async function handleDownload(file: ExportFileName) {
    if (!run) return
    try {
      await apiDownloadExportFile(run.id, file)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed.')
    }
  }

  // §22/§50-52: loops apiExecuteRunBatch — the browser IS the primary
  // driver of execution (this deployment has no required background
  // worker). Bounded by run state, not an arbitrary iteration cap: stops on
  // paused/cancelled/needs_attention/completed/failed, on any error, and on
  // a pathological no-progress state (surfaces a message rather than
  // spinning forever). Polls with a short delay between active batches and
  // a longer one while idle, and waits (capped) for a scheduled retry
  // rather than hammering the API. cancelRequestedRef lets Pause stop the
  // loop immediately, before its next batch call even starts.
  async function handleRunAll() {
    if (!run) return
    cancelRequestedRef.current = false
    setRunningAll(true)
    setError(null)
    setRunAllNotice(null)
    let consecutiveNoProgress = 0
    try {
      while (!cancelRequestedRef.current) {
        const result = await apiExecuteRunBatch(run.id)
        setProgress(await apiGetRunProgress(run.id))
        setRun(result.run)

        if (result.run.status !== 'running') break

        if (result.processed > 0) {
          consecutiveNoProgress = 0
          await delay(ACTIVE_POLL_MS)
          continue
        }

        if (result.nextRetryAt) {
          const waitMs = Math.max(0, new Date(result.nextRetryAt).getTime() - Date.now())
          await delay(Math.min(waitMs, MAX_RETRY_WAIT_MS))
          continue
        }

        consecutiveNoProgress++
        if (consecutiveNoProgress >= MAX_CONSECUTIVE_NO_PROGRESS) {
          setRunAllNotice('No executable work found. Run may require recovery.')
          break
        }
        await delay(IDLE_POLL_MS)
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
                <button onClick={handlePause} disabled={busy}
                  className="text-xs font-medium px-3.5 py-2 rounded-xl border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 disabled:opacity-40">
                  Pause
                </button>
              </>
            )}
            {run.status === 'paused' && (
              <>
                <button onClick={handleResume} disabled={busy}
                  className="text-xs font-medium px-3.5 py-2 rounded-xl bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900 disabled:opacity-40">
                  {busy ? 'Resuming…' : 'Resume'}
                </button>
                <button onClick={handleRecover} disabled={busy}
                  className="text-xs font-medium px-3.5 py-2 rounded-xl border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 disabled:opacity-40">
                  Recover Interrupted Work
                </button>
              </>
            )}
            <button onClick={handleCancel} disabled={busy || runningAll}
              className="text-xs font-medium px-3.5 py-2 rounded-xl border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 disabled:opacity-40">
              Cancel
            </button>
          </div>
        )}

        {run.status === 'running' && !runningAll && progress && progress.staleRunningJobs > 0 && (
          <div className="text-sm text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-xl px-4 py-2.5 flex items-center justify-between gap-3">
            <span>Interrupted — {progress.staleRunningJobs} job(s) look stuck from a previous session and are ready to reconcile.</span>
            <button onClick={handleRecover} disabled={busy} className="text-xs font-medium underline shrink-0 disabled:opacity-40">
              Recover Interrupted Work
            </button>
          </div>
        )}

        {(run.status === 'running' || run.status === 'paused') && (
          <p className="text-xs text-gray-400 dark:text-gray-500">
            You may close this page or lose connection. Completed benchmark work is checkpointed. When you return, Resume (or
            Recover Interrupted Work) will reconcile interrupted jobs and continue from unfinished work — a job whose result was
            never confirmed as saved may need to run again, but nothing already checkpointed is ever repeated.
          </p>
        )}

        {resumeFeedback && (
          <RecoverySummaryCard title="Recovery complete" summary={resumeFeedback} onDismiss={() => setResumeFeedback(null)} />
        )}
        {recoverFeedback && (
          <RecoverySummaryCard title="Recovery complete" summary={recoverFeedback} onDismiss={() => setRecoverFeedback(null)} />
        )}
        {runAllNotice && (
          <div className="text-sm text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-xl px-4 py-2.5 flex items-center justify-between gap-3">
            <span>{runAllNotice}</span>
            <button onClick={() => setRunAllNotice(null)} className="text-xs font-medium underline shrink-0">Dismiss</button>
          </div>
        )}

        {run.status === 'needs_attention' && (
          <div className="border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-900/20 rounded-2xl p-4 space-y-2">
            <h2 className="text-xs font-semibold text-red-700 dark:text-red-400 uppercase tracking-wider">Needs Attention</h2>
            <p className="text-sm text-red-700 dark:text-red-400">
              Execution finished with unresolved failures ({progress?.failedJobs ?? 0} failed job(s)) — this run cannot be
              released until every failure is resolved. Recover checks whether interrupted work already succeeded; Retry
              requeues genuine failures; Cancel abandons the run.
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={handleRetryFailedJobs} disabled={busy}
                className="text-xs font-medium px-3.5 py-2 rounded-xl bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900 disabled:opacity-40">
                {busy ? 'Retrying…' : 'Retry Failed Jobs'}
              </button>
              <button onClick={handleRecover} disabled={busy}
                className="text-xs font-medium px-3.5 py-2 rounded-xl border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 disabled:opacity-40">
                Recover Interrupted Work
              </button>
              <Link href={`/admin/a2h/runs/${run.id}/failed-jobs`}
                className="text-xs font-medium px-3.5 py-2 rounded-xl border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300">
                View Failed Jobs
              </Link>
              <button onClick={handleCancel} disabled={busy}
                className="text-xs font-medium px-3.5 py-2 rounded-xl border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 disabled:opacity-40">
                Cancel
              </button>
            </div>
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
              <span className="text-gray-500 dark:text-gray-400">Jobs completed</span>
              <span className="tabular-nums text-gray-700 dark:text-gray-300">{progress.completedJobs.toLocaleString()} / {progress.totalJobs.toLocaleString()}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-500 dark:text-gray-400">Running</span>
              <span className="tabular-nums text-gray-700 dark:text-gray-300">
                {progress.runningJobs}{progress.staleRunningJobs > 0 ? ` (${progress.staleRunningJobs} stale)` : ''}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-500 dark:text-gray-400">Queued</span>
              <span className="text-gray-700 dark:text-gray-300">{progress.queuedJobs - progress.retryingJobs}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-500 dark:text-gray-400">Waiting to retry</span>
              <span className="text-gray-700 dark:text-gray-300">{progress.retryingJobs}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-500 dark:text-gray-400">Failed</span>
              <span className={progress.failedJobs > 0 ? 'text-red-600 dark:text-red-400 font-medium' : 'text-gray-700 dark:text-gray-300'}>{progress.failedJobs}</span>
            </div>
            <div className="flex items-center justify-between text-sm pt-1 border-t border-gray-100 dark:border-gray-900 mt-1">
              <span className="text-gray-500 dark:text-gray-400">Last checkpoint</span>
              <span className="text-gray-700 dark:text-gray-300">{progress.lastCheckpointAt ? new Date(progress.lastCheckpointAt).toLocaleTimeString() : '—'}</span>
            </div>
            {progress.nextRetryAt && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500 dark:text-gray-400">Next retry</span>
                <span className="text-gray-700 dark:text-gray-300">{new Date(progress.nextRetryAt).toLocaleTimeString()}</span>
              </div>
            )}
            {run.status === 'paused' && (
              <p className="text-xs text-gray-400 dark:text-gray-500 pt-1 border-t border-gray-100 dark:border-gray-900 mt-1">
                No new jobs will start.{progress.runningJobs > 0 ? ` ${progress.runningJobs} in-flight job(s) may still finish and checkpoint.` : ''}
              </p>
            )}
          </div>
        )}

        {(run.status === 'completed' || run.status === 'needs_attention') && releaseInfo && (
          <div className="border border-gray-200 dark:border-gray-800 rounded-2xl p-4 space-y-3">
            <h2 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Benchmark Release</h2>

            {!releaseInfo.release && (
              <>
                {releaseInfo.readiness.errors.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-red-700 dark:text-red-400">Not ready to release:</p>
                    {releaseInfo.readiness.errors.map((e, i) => <p key={i} className="text-sm text-red-600 dark:text-red-400">• {e}</p>)}
                  </div>
                )}
                {releaseInfo.readiness.warnings.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-amber-700 dark:text-amber-400">Warnings:</p>
                    {releaseInfo.readiness.warnings.map((w, i) => <p key={i} className="text-sm text-amber-600 dark:text-amber-400">• {w}</p>)}
                  </div>
                )}
                <p className="text-xs text-gray-400 dark:text-gray-500">
                  Freezing a release locks this run&apos;s evidence permanently — outputs, results, and reported numbers can never be
                  regenerated or overwritten afterward.
                </p>
                <button onClick={handleFreezeRelease} disabled={busy || !releaseInfo.readiness.ok}
                  className="text-xs font-medium px-3.5 py-2 rounded-xl bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900 disabled:opacity-40">
                  {busy ? 'Freezing…' : 'Freeze Benchmark Release'}
                </button>
              </>
            )}

            {releaseInfo.release && (
              <>
                <dl className="space-y-1 text-sm">
                  <div className="flex justify-between"><dt className="text-gray-500 dark:text-gray-400">Release version</dt><dd className="text-gray-800 dark:text-gray-200">{releaseInfo.release.releaseVersion}</dd></div>
                  <div className="flex justify-between"><dt className="text-gray-500 dark:text-gray-400">Released at</dt><dd className="text-gray-800 dark:text-gray-200">{new Date(releaseInfo.release.releasedAt).toLocaleString()}</dd></div>
                  <div className="flex justify-between"><dt className="text-gray-500 dark:text-gray-400">Release hash</dt><dd className="font-mono text-xs text-gray-600 dark:text-gray-400">{releaseInfo.release.releaseHash.slice(0, 16)}…</dd></div>
                  <div className="flex justify-between"><dt className="text-gray-500 dark:text-gray-400">Primary outputs</dt><dd className="tabular-nums text-gray-800 dark:text-gray-200">{releaseInfo.release.primaryOutputCount.toLocaleString()}</dd></div>
                  <div className="flex justify-between"><dt className="text-gray-500 dark:text-gray-400">Test results</dt><dd className="tabular-nums text-gray-800 dark:text-gray-200">{releaseInfo.release.testResultCount.toLocaleString()}</dd></div>
                  <div className="flex justify-between"><dt className="text-gray-500 dark:text-gray-400">Excluded records</dt><dd className="tabular-nums text-gray-800 dark:text-gray-200">{releaseInfo.release.excludedRecordCount.toLocaleString()}</dd></div>
                </dl>

                <div className="flex items-center gap-2">
                  <button onClick={handleVerifyIntegrity} disabled={busy}
                    className="text-xs font-medium px-3.5 py-2 rounded-xl border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 disabled:opacity-40">
                    {busy ? 'Verifying…' : 'Verify Integrity'}
                  </button>
                </div>
                {integrityResult && (
                  <p className={`text-sm ${integrityResult.ok ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                    {integrityResult.ok ? 'Integrity verified — all stored hashes match current records.' : `Integrity check failed: ${integrityResult.errors.join(' ')}`}
                  </p>
                )}

                <div className="space-y-1 pt-2 border-t border-gray-100 dark:border-gray-900">
                  <p className="text-xs text-gray-400 dark:text-gray-500 uppercase tracking-wider">Export</p>
                  <div className="flex flex-wrap gap-1.5">
                    {EXPORT_FILE_NAMES.map(file => (
                      <button key={file} onClick={() => handleDownload(file)}
                        className="text-xs font-medium px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-400 dark:hover:border-gray-500">
                        {file}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {(run.status === 'running' || run.status === 'completed' || run.status === 'paused' || run.status === 'failed' || run.status === 'needs_attention') && (
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

// §39 of the Phase 5A spec — the feedback shown after Resume or a manual
// Recover action: how many stale/interrupted jobs were found, how many
// already had valid evidence (reused, never re-paid for), how many were
// returned to the queue, and how many couldn't be resolved automatically.
function RecoverySummaryCard({ title, summary, onDismiss }: { title: string; summary: RecoverySummary; onDismiss: () => void }) {
  return (
    <div className="border border-gray-200 dark:border-gray-800 rounded-2xl p-4 space-y-1.5">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">{title}</h2>
        <button onClick={onDismiss} className="text-xs text-gray-400 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-300">Dismiss</button>
      </div>
      <div className="flex items-center justify-between text-sm">
        <span className="text-gray-500 dark:text-gray-400">Interrupted jobs found</span>
        <span className="tabular-nums text-gray-700 dark:text-gray-300">{summary.staleJobsFound}</span>
      </div>
      <div className="flex items-center justify-between text-sm">
        <span className="text-gray-500 dark:text-gray-400">Recovered from saved evidence</span>
        <span className="tabular-nums text-green-700 dark:text-green-400">{summary.reconciledCompleted}</span>
      </div>
      <div className="flex items-center justify-between text-sm">
        <span className="text-gray-500 dark:text-gray-400">Returned to queue</span>
        <span className="tabular-nums text-gray-700 dark:text-gray-300">{summary.requeued}</span>
      </div>
      <div className="flex items-center justify-between text-sm">
        <span className="text-gray-500 dark:text-gray-400">Unresolved</span>
        <span className={summary.unresolved > 0 ? 'tabular-nums text-red-600 dark:text-red-400 font-medium' : 'tabular-nums text-gray-700 dark:text-gray-300'}>{summary.unresolved}</span>
      </div>
    </div>
  )
}

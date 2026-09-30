'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import {
  apiGetProject, apiGetManifest, apiListRuns, apiCreateRun,
  type CorpusProject, type CorpusManifest, type BenchmarkRun,
} from '@/lib/a2hApi'
import { Spinner } from '@/components/ui/Spinner'

const STATUS_LABEL: Record<BenchmarkRun['status'], string> = {
  draft: 'Draft',
  validated: 'Validated',
  running: 'Running',
  paused: 'Paused',
  completed: 'Complete',
  failed: 'Failed',
  cancelled: 'Cancelled',
}

const STATUS_STYLE: Record<BenchmarkRun['status'], string> = {
  draft: 'text-gray-500 dark:text-gray-400',
  validated: 'text-blue-600 dark:text-blue-400',
  running: 'text-amber-600 dark:text-amber-400',
  paused: 'text-amber-600 dark:text-amber-400',
  completed: 'text-green-700 dark:text-green-400',
  failed: 'text-red-600 dark:text-red-400',
  cancelled: 'text-gray-400 dark:text-gray-600',
}

// Run-management landing page (§5) — a frozen corpus is reusable across
// arbitrarily many independent Benchmark Runs, so this replaces what used to
// be a single document-centric execution UI (per-cell baseline/transform/
// post-score buttons) with a list of runs plus a "New Benchmark Run" action.
// Actual execution — corpus preparation vs. benchmark execution — lives on
// each run's own detail page.
export default function A2HBenchmarkPage() {
  const projectId = useSearchParams().get('project') ?? ''

  const [project, setProject] = useState<CorpusProject | null>(null)
  const [manifest, setManifest] = useState<CorpusManifest | null>(null)
  const [runs, setRuns] = useState<BenchmarkRun[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!projectId) { setError('No corpus project selected.'); setLoading(false); return }
    let cancelled = false
    Promise.all([apiGetProject(projectId), apiGetManifest(projectId), apiListRuns(projectId)])
      .then(([p, m, r]) => {
        if (cancelled) return
        setProject(p)
        setManifest(m)
        setRuns(r)
      })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load benchmark runs.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [projectId])

  async function handleCreate() {
    if (!newName.trim()) return
    setBusy(true)
    setError(null)
    try {
      const run = await apiCreateRun({ corpusProjectId: projectId, name: newName.trim() })
      setRuns(prev => [run, ...prev])
      setNewName('')
      setCreating(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create benchmark run.')
    } finally {
      setBusy(false)
    }
  }

  if (!projectId) {
    return (
      <div className="min-h-screen bg-white dark:bg-gray-950 p-6">
        <div className="max-w-3xl mx-auto text-sm text-gray-400 dark:text-gray-500 py-12 text-center">
          No corpus project selected.{' '}
          <Link href="/admin/a2h" className="underline hover:text-gray-700 dark:hover:text-gray-300">Pick one from the A2H home</Link>.
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950 p-6">
      <div className="max-w-3xl mx-auto space-y-5">
        <div>
          <Link href={`/admin/a2h/corpus?project=${projectId}`} className="text-xs text-gray-400 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-300">← {project?.name ?? 'A2H Benchmark'}</Link>
          <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mt-1">Benchmark Runs</h1>
          {project && (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {project.name}
              {manifest && <> · Manifest: <span className="font-mono">{manifest.manifestHash.slice(0, 8)}…</span></>}
            </p>
          )}
          <Link href={`/admin/a2h/fixtures?project=${projectId}`} className="text-xs underline text-gray-400 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-300">
            Fixture Sets (A2H-04/05/09/10/13) →
          </Link>
        </div>

        {project && project.status !== 'frozen' && (
          <div className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-xl px-4 py-2.5">
            This corpus is not frozen yet — a benchmark run can only be created against a frozen corpus with a manifest.{' '}
            <Link href={`/admin/a2h/corpus?project=${projectId}`} className="underline">Go to Source Matrix</Link>.
          </div>
        )}

        {error && (
          <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-xl px-4 py-2.5">{error}</div>
        )}

        {loading ? (
          <div className="flex justify-center py-12">
            <Spinner className="w-6 h-6 border-gray-200 border-t-gray-700 dark:border-gray-700 dark:border-t-gray-300" />
          </div>
        ) : (
          <>
            {project?.status === 'frozen' && (
              <div className="border border-gray-200 dark:border-gray-800 rounded-2xl p-4">
                {creating ? (
                  <div className="flex items-center gap-2">
                    <input
                      autoFocus value={newName} onChange={e => setNewName(e.target.value)}
                      placeholder="e.g. A2H Standard Run 001"
                      className="flex-1 text-sm rounded-xl px-3 py-2 bg-white border border-gray-300 text-gray-700 dark:bg-gray-900 dark:border-gray-700 dark:text-gray-300 focus:outline-none focus:border-gray-900 dark:focus:border-gray-100"
                    />
                    <button onClick={handleCreate} disabled={busy || !newName.trim()}
                      className="text-sm px-3.5 py-2 rounded-xl bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900 disabled:opacity-40">
                      {busy ? 'Creating…' : 'Create'}
                    </button>
                    <button onClick={() => setCreating(false)} className="text-sm text-gray-500 hover:text-gray-800 dark:hover:text-gray-300 px-2">Cancel</button>
                  </div>
                ) : (
                  <button onClick={() => setCreating(true)}
                    className="w-full text-sm px-3.5 py-2 rounded-xl border border-dashed border-gray-300 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors">
                    + New Benchmark Run
                  </button>
                )}
              </div>
            )}

            <div className="border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden">
              <div className="grid grid-cols-[1fr_auto_auto_auto] gap-3 px-4 py-2 text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider border-b border-gray-100 dark:border-gray-900">
                <span>Run</span>
                <span>Status</span>
                <span>Sources</span>
                <span>Intensities</span>
              </div>
              {runs.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-gray-400 dark:text-gray-500">No benchmark runs yet.</div>
              ) : (
                runs.map(run => (
                  <Link
                    key={run.id}
                    href={`/admin/a2h/runs/${run.id}`}
                    className="grid grid-cols-[1fr_auto_auto_auto] gap-3 px-4 py-3 items-center text-sm border-b border-gray-100 dark:border-gray-900 last:border-b-0 hover:bg-gray-50 dark:hover:bg-gray-900/50 transition-colors"
                  >
                    <span className="text-gray-800 dark:text-gray-200 truncate">{run.name}</span>
                    <span className={STATUS_STYLE[run.status]}>{STATUS_LABEL[run.status]}</span>
                    <span className="text-gray-500 dark:text-gray-400 tabular-nums">{(run.selectedTopicIds.length * run.selectedLengths.length).toLocaleString()}</span>
                    <span className="text-gray-500 dark:text-gray-400 tabular-nums">{run.intensities.length}</span>
                  </Link>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

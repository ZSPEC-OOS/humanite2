'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { apiGetRun, apiListFailedJobs, type BenchmarkRun, type BenchmarkJob } from '@/lib/a2hApi'
import { Spinner } from '@/components/ui/Spinner'

// Phase 5A (§41): a read-only drilldown of exactly what's blocking a
// needs_attention run — no bulk action here (retrying happens through the
// dedicated Retry Failed Jobs action on the run page, never a raw edit).
export default function A2HFailedJobsPage() {
  const runId = useParams().runId as string
  const [run, setRun] = useState<BenchmarkRun | null>(null)
  const [jobs, setJobs] = useState<BenchmarkJob[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([apiGetRun(runId), apiListFailedJobs(runId)])
      .then(([r, j]) => {
        if (cancelled) return
        setRun(r)
        setJobs(j)
      })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load failed jobs.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [runId])

  if (loading) {
    return (
      <div className="min-h-screen bg-white dark:bg-gray-950 flex items-center justify-center">
        <Spinner className="w-6 h-6 border-gray-200 border-t-gray-700 dark:border-gray-700 dark:border-t-gray-300" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950 p-6">
      <div className="max-w-4xl mx-auto space-y-4">
        <div>
          <Link href={`/admin/a2h/runs/${runId}`} className="text-xs text-gray-400 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-300">← {run?.name ?? 'Run'}</Link>
          <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mt-1">Failed Jobs</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{jobs.length} job(s) currently failed. Retrying happens from the run page.</p>
        </div>

        {error && <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-xl px-4 py-2.5">{error}</div>}

        {jobs.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-500">No failed jobs.</p>
        ) : (
          <div className="border border-gray-200 dark:border-gray-800 rounded-2xl divide-y divide-gray-100 dark:divide-gray-900">
            <div className="grid grid-cols-[1fr_1fr_1fr_auto_auto] gap-2 px-4 py-2 text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
              <span>Stage</span>
              <span>Test</span>
              <span>Source / condition</span>
              <span>Attempts</span>
              <span>Last attempt</span>
            </div>
            {jobs.map(job => {
              const condition = [
                job.intensity != null ? `intensity ${job.intensity}` : null,
                job.fixtureId ? `fixture ${job.fixtureId.slice(0, 8)}…` : null,
                job.conditionId ? `condition ${job.conditionId}` : null,
                job.trialIndex != null ? `trial #${job.trialIndex}` : null,
              ].filter(Boolean).join(', ')
              const isExpanded = expanded === job.id
              return (
                <div key={job.id} className="px-4 py-2.5">
                  <button onClick={() => setExpanded(isExpanded ? null : job.id)} className="w-full text-left grid grid-cols-[1fr_1fr_1fr_auto_auto] gap-2 items-center text-sm">
                    <span className="text-gray-700 dark:text-gray-300">{job.stage}</span>
                    <span className="text-gray-700 dark:text-gray-300">{job.benchmarkCode ?? '—'}</span>
                    <span className="text-gray-500 dark:text-gray-400 truncate" title={job.sourceId}>{job.sourceId.slice(0, 12)}…{condition ? ` · ${condition}` : ''}</span>
                    <span className="tabular-nums text-gray-700 dark:text-gray-300">{job.attemptCount}</span>
                    <span className="text-gray-500 dark:text-gray-400">{job.completedAt ? new Date(job.completedAt).toLocaleString() : '—'}</span>
                  </button>
                  {isExpanded && (
                    <div className="mt-2 text-xs bg-gray-50 dark:bg-gray-900/50 rounded-xl p-3 space-y-1">
                      <p><span className="text-gray-400 dark:text-gray-500">Job id:</span> <span className="font-mono">{job.id}</span></p>
                      <p><span className="text-gray-400 dark:text-gray-500">Error code:</span> {job.errorCode ?? '—'}</p>
                      <p><span className="text-gray-400 dark:text-gray-500">Error message:</span> {job.errorMessage ?? '—'}</p>
                      <p><span className="text-gray-400 dark:text-gray-500">Failure class:</span> {job.failureClass ?? '—'}</p>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

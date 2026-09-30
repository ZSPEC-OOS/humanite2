'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { apiGetRun, apiGetA2H03Report, apiGetProject, type BenchmarkRun, type A2H03Report, type CorpusProject } from '@/lib/a2hApi'
import { Spinner } from '@/components/ui/Spinner'

function num(n: number | null, digits = 3): string {
  return n == null ? '—' : n.toFixed(digits)
}
function pct(n: number | null): string {
  return n == null ? '—' : `${(n * 100).toFixed(1)}%`
}

// A2H-03 makes no Humanite or GPTZero calls — this page is a pure read of
// already-computed A2H-01/A2H-02 results, grouped by source.targetWords.
export default function A2H03ResultsPage() {
  const runId = useParams().runId as string

  const [run, setRun] = useState<BenchmarkRun | null>(null)
  const [project, setProject] = useState<CorpusProject | null>(null)
  const [report, setReport] = useState<A2H03Report | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    apiGetRun(runId).then(r => { if (!cancelled) { setRun(r); return apiGetProject(r.corpusProjectId) } }).then(p => { if (!cancelled && p) setProject(p) }).catch(() => {})
    apiGetA2H03Report(runId)
      .then(r => { if (!cancelled) setReport(r) })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load report.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [runId])

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950 p-6">
      <div className="max-w-4xl mx-auto space-y-5">
        <div>
          <Link href={`/admin/a2h/runs/${runId}`} className="text-xs text-gray-400 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-300">← {run?.name ?? 'Run'}</Link>
          <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mt-1">A2H-03 Length Performance</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Run: {run?.name} · Corpus: {project?.name} · derived from A2H-01/A2H-02, no additional calls</p>
        </div>

        {error && <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-xl px-4 py-2.5">{error}</div>}

        {loading || !report ? (
          <div className="flex justify-center py-12"><Spinner className="w-6 h-6 border-gray-200 border-t-gray-700 dark:border-gray-700 dark:border-t-gray-300" /></div>
        ) : report.byLength.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-500 py-8 text-center">No A2H-01/A2H-02 results yet for this run.</p>
        ) : (
          <div className="border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-800 text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                  <th className="text-left px-3 py-2">Length</th>
                  <th className="text-right px-3 py-2">N</th>
                  <th className="text-right px-3 py-2">Conversion</th>
                  <th className="text-right px-3 py-2">Mean ΔAI</th>
                  <th className="text-right px-3 py-2">Mean Magnitude</th>
                  <th className="text-right px-3 py-2">Mean |Δwords|</th>
                </tr>
              </thead>
              <tbody>
                {report.byLength.map(group => (
                  <tr key={group.targetWords} className="border-b border-gray-100 dark:border-gray-900 last:border-b-0">
                    <td className="px-3 py-2 text-gray-800 dark:text-gray-200">{group.targetWords}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-500 dark:text-gray-400">{group.n}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-700 dark:text-gray-300">{pct(group.conversionRate.successRate)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-700 dark:text-gray-300">{num(group.deltaAiProbability.mean, 3)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-700 dark:text-gray-300">{num(group.transformationMagnitude.mean, 3)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-500 dark:text-gray-400">{num(group.wordCountAbsChange.mean, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

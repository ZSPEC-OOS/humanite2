'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { apiGetRun, apiGetA2H02Report, apiGetProject, type BenchmarkRun, type A2H02Report, type CorpusProject } from '@/lib/a2hApi'
import { Spinner } from '@/components/ui/Spinner'

function num(n: number | null, digits = 3): string {
  return n == null ? '—' : n.toFixed(digits)
}
function pct(n: number | null): string {
  return n == null ? '—' : `${(n * 100).toFixed(1)}%`
}

type Metric = 'magnitude' | 'conversion' | 'aiProbability' | 'wordCount'
const METRIC_LABEL: Record<Metric, string> = {
  magnitude: 'Transformation magnitude',
  conversion: 'Conversion rate',
  aiProbability: 'Mean AI probability',
  wordCount: 'Mean |word count change|',
}

export default function A2H02ResultsPage() {
  const runId = useParams().runId as string

  const [run, setRun] = useState<BenchmarkRun | null>(null)
  const [project, setProject] = useState<CorpusProject | null>(null)
  const [report, setReport] = useState<A2H02Report | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [metric, setMetric] = useState<Metric>('magnitude')

  useEffect(() => {
    let cancelled = false
    apiGetRun(runId).then(r => { if (!cancelled) { setRun(r); return apiGetProject(r.corpusProjectId) } }).then(p => { if (!cancelled && p) setProject(p) }).catch(() => {})
    apiGetA2H02Report(runId)
      .then(r => { if (!cancelled) setReport(r) })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load report.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [runId])

  const levels = report ? Object.keys(report.byIntensity).map(Number).sort((a, b) => a - b) : []
  const valuesByLevel = report ? levels.map(l => {
    const agg = report.byIntensity[l]!
    if (metric === 'magnitude') return agg.transformationMagnitude.mean ?? 0
    if (metric === 'conversion') return agg.conversionRate.successRate ?? 0
    if (metric === 'aiProbability') return agg.aiProbability.mean ?? 0
    return agg.wordCountAbsChange.mean ?? 0
  }) : []
  const maxValue = Math.max(...valuesByLevel, 0.01)

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950 p-6">
      <div className="max-w-5xl mx-auto space-y-5">
        <div>
          <Link href={`/admin/a2h/runs/${runId}`} className="text-xs text-gray-400 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-300">← {run?.name ?? 'Run'}</Link>
          <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mt-1">A2H-02 Intensity Response</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Run: {run?.name} · Corpus: {project?.name}</p>
        </div>

        {error && <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-xl px-4 py-2.5">{error}</div>}

        {loading || !report ? (
          <div className="flex justify-center py-12"><Spinner className="w-6 h-6 border-gray-200 border-t-gray-700 dark:border-gray-700 dark:border-t-gray-300" /></div>
        ) : (
          <>
            <p className="text-sm text-gray-500 dark:text-gray-400">N: {report.overall.n.toLocaleString()} outputs</p>

            {report.trend && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <Card label="Intensity↔Magnitude correlation" value={report.trend.correlation.toFixed(3)} />
                <Card label="Increasing steps" value={`${report.trend.increasingSteps} / ${report.trend.totalSteps}`} />
                <Card label="Low / Mid / High bands" value={`${num(report.trend.lowBandMean, 2)} / ${num(report.trend.midBandMean, 2)} / ${num(report.trend.highBandMean, 2)}`} />
              </div>
            )}

            <div className="border border-gray-200 dark:border-gray-800 rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">By Intensity</h2>
                <select value={metric} onChange={e => setMetric(e.target.value as Metric)}
                  className="text-xs rounded-lg px-2 py-1 bg-white border border-gray-300 text-gray-700 dark:bg-gray-900 dark:border-gray-700 dark:text-gray-300">
                  {(Object.keys(METRIC_LABEL) as Metric[]).map(m => <option key={m} value={m}>{METRIC_LABEL[m]}</option>)}
                </select>
              </div>
              <div className="flex items-end gap-2 h-32">
                {levels.map((l, i) => (
                  <div key={l} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full flex-1 flex items-end">
                      <div className="w-full bg-blue-500 dark:bg-blue-600 rounded-t" style={{ height: `${(valuesByLevel[i]! / maxValue) * 100}%` }} />
                    </div>
                    <span className="text-[10px] text-gray-400 dark:text-gray-500">I{l}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="border border-gray-200 dark:border-gray-800 rounded-2xl p-4 space-y-1.5">
              <h2 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1">Per-Intensity Statistics</h2>
              {levels.map(l => {
                const agg = report.byIntensity[l]!
                return (
                  <div key={l} className="flex items-center gap-3 text-xs">
                    <span className="w-12 shrink-0 text-gray-600 dark:text-gray-400">I{l}</span>
                    <span className="text-gray-400 dark:text-gray-500">n={agg.n}</span>
                    <span className="text-gray-700 dark:text-gray-300">mag {num(agg.transformationMagnitude.mean, 2)}</span>
                    <span className="text-gray-700 dark:text-gray-300">conv {pct(agg.conversionRate.successRate)}</span>
                    <span className="text-gray-700 dark:text-gray-300">ΔAI {num(agg.aiProbability.mean, 2)}</span>
                    <span className="text-gray-400 dark:text-gray-500">|Δwords| {num(agg.wordCountAbsChange.mean, 1)}</span>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-gray-200 dark:border-gray-800 rounded-2xl p-4">
      <p className="text-xs text-gray-400 dark:text-gray-500 uppercase tracking-wider">{label}</p>
      <p className="text-lg font-semibold text-gray-900 dark:text-gray-100 tabular-nums mt-1">{value}</p>
    </div>
  )
}

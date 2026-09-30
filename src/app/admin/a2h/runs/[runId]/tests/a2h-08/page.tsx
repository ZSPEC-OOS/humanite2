'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { DOMAINS, type Domain } from '@/lib/style/types'
import { apiGetRun, apiGetA2H08Report, apiGetProject, type BenchmarkRun, type A2H08Report, type CorpusProject } from '@/lib/a2hApi'
import { Spinner } from '@/components/ui/Spinner'
import { Card, Section, num } from '@/components/a2h/ResultsPageChrome'

export default function A2H08ResultsPage() {
  const runId = useParams().runId as string

  const [run, setRun] = useState<BenchmarkRun | null>(null)
  const [project, setProject] = useState<CorpusProject | null>(null)
  const [report, setReport] = useState<A2H08Report | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [domainFilter, setDomainFilter] = useState<Domain | ''>('')
  const [intensityFilter, setIntensityFilter] = useState<number | ''>('')

  useEffect(() => {
    let cancelled = false
    apiGetRun(runId).then(r => { if (!cancelled) { setRun(r); return apiGetProject(r.corpusProjectId) } }).then(p => { if (!cancelled && p) setProject(p) }).catch(() => {})
    return () => { cancelled = true }
  }, [runId])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    apiGetA2H08Report(runId, { ...(domainFilter ? { domainId: domainFilter } : {}), ...(intensityFilter ? { intensity: intensityFilter } : {}) })
      .then(r => { if (!cancelled) setReport(r) })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load report.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [runId, domainFilter, intensityFilter])

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950 p-6">
      <div className="max-w-5xl mx-auto space-y-5">
        <div>
          <Link href={`/admin/a2h/runs/${runId}`} className="text-xs text-gray-400 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-300">← {run?.name ?? 'Run'}</Link>
          <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mt-1">A2H-08 Grammar Damage</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Run: {run?.name} · Corpus: {project?.name} · Grammar engine: {run?.grammarEngineConfigVersion ?? '—'}
          </p>
        </div>

        {error && <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-xl px-4 py-2.5">{error}</div>}

        <div className="flex items-center gap-2 text-xs">
          <select value={domainFilter} onChange={e => setDomainFilter(e.target.value as Domain | '')}
            className="rounded-lg px-2 py-1.5 bg-white border border-gray-300 text-gray-700 dark:bg-gray-900 dark:border-gray-700 dark:text-gray-300">
            <option value="">All domains</option>
            {DOMAINS.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <select value={intensityFilter} onChange={e => setIntensityFilter(e.target.value ? Number(e.target.value) : '')}
            className="rounded-lg px-2 py-1.5 bg-white border border-gray-300 text-gray-700 dark:bg-gray-900 dark:border-gray-700 dark:text-gray-300">
            <option value="">All intensities</option>
            {(run?.intensities ?? []).map(i => <option key={i} value={i}>Intensity {i}</option>)}
          </select>
        </div>

        {loading || !report ? (
          <div className="flex justify-center py-12"><Spinner className="w-6 h-6 border-gray-200 border-t-gray-700 dark:border-gray-700 dark:border-t-gray-300" /></div>
        ) : (
          <>
            <p className="text-sm text-gray-500 dark:text-gray-400">Outputs evaluated: {report.overall.n.toLocaleString()}</p>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Card label="Mean New Errors / 1000 Words" value={num(report.overall.newErrorsPer1000.mean, 2)} sub={`95% CI [${num(report.overall.newErrorsPer1000.ciLow95, 2)}, ${num(report.overall.newErrorsPer1000.ciHigh95, 2)}]`} />
              <Card label="Median New Errors / 1000 Words" value={num(report.overall.newErrorsPer1000.median, 2)} />
              <Card label="Outputs With Zero New Errors" value={report.overall.zeroNewErrorsCount.toLocaleString()} />
              <Card label="Outputs With ≥1 New Error" value={report.overall.anyNewErrorsCount.toLocaleString()} />
              <Card label="Total New Errors" value={report.overall.totalNewErrors.toLocaleString()} />
              <Card label="P5 / P95" value={`${num(report.overall.newErrorsPer1000.p5, 2)} / ${num(report.overall.newErrorsPer1000.p95, 2)}`} />
              <Card label="SD" value={num(report.overall.newErrorsPer1000.sd, 2)} />
            </div>

            <Section title="New Errors by Category">
              {Object.keys(report.overall.newErrorsByCategory).length === 0 ? (
                <p className="text-xs text-gray-400 dark:text-gray-500">No new errors introduced by any category.</p>
              ) : (
                <div className="space-y-1 text-xs">
                  {Object.entries(report.overall.newErrorsByCategory).sort((a, b) => b[1] - a[1]).map(([category, count]) => (
                    <div key={category} className="flex justify-between">
                      <span className="text-gray-600 dark:text-gray-400">{category}</span>
                      <span className="tabular-nums text-gray-800 dark:text-gray-200 font-semibold">{count}</span>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            <Section title="New Errors / 1000 Words by Domain">
              <div className="space-y-1.5">
                {Object.entries(report.byDomain).map(([k, v]) => (
                  <div key={k} className="flex items-center gap-3 text-xs">
                    <span className="w-24 shrink-0 text-gray-600 dark:text-gray-400">{k}</span>
                    <span className="tabular-nums text-gray-700 dark:text-gray-300">{num(v.newErrorsPer1000.mean, 2)}</span>
                    <span className="text-gray-400 dark:text-gray-500">n={v.n}</span>
                  </div>
                ))}
              </div>
            </Section>

            <Section title="New Errors / 1000 Words by Length">
              <div className="space-y-1.5">
                {Object.entries(report.byLength).map(([k, v]) => (
                  <div key={k} className="flex items-center gap-3 text-xs">
                    <span className="w-24 shrink-0 text-gray-600 dark:text-gray-400">{k} words</span>
                    <span className="tabular-nums text-gray-700 dark:text-gray-300">{num(v.newErrorsPer1000.mean, 2)}</span>
                    <span className="text-gray-400 dark:text-gray-500">n={v.n}</span>
                  </div>
                ))}
              </div>
            </Section>

            <Section title="New Errors / 1000 Words by Intensity">
              <div className="space-y-1.5">
                {Object.entries(report.byIntensity).map(([k, v]) => (
                  <div key={k} className="flex items-center gap-3 text-xs">
                    <span className="w-24 shrink-0 text-gray-600 dark:text-gray-400">Intensity {k}</span>
                    <span className="tabular-nums text-gray-700 dark:text-gray-300">{num(v.newErrorsPer1000.mean, 2)}</span>
                    <span className="text-gray-400 dark:text-gray-500">n={v.n}</span>
                  </div>
                ))}
              </div>
            </Section>

            <Section title="Outputs With New Errors">
              <div className="max-h-64 overflow-y-auto space-y-1">
                {report.rows.filter(r => r.measurements.eligible && !r.measurements.zeroNewErrors).slice(0, 200).map(row => (
                  <Link key={row.outputId} href={`/admin/a2h/runs/${runId}/outputs/${row.outputId}`}
                    className="flex items-center gap-3 text-xs px-2 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-900/50 transition-colors">
                    <span className="w-16 shrink-0 capitalize text-gray-600 dark:text-gray-400">{row.domainId}</span>
                    <span className="w-14 shrink-0 text-gray-500 dark:text-gray-400">{row.targetWords}w</span>
                    <span className="w-10 shrink-0 text-gray-500 dark:text-gray-400">I{row.intensity}</span>
                    <span className="text-red-600 dark:text-red-400">{row.measurements.newErrorCount} new error(s)</span>
                    <span className="ml-auto text-gray-400 dark:text-gray-500">{num(row.measurements.newErrorsPer1000, 2)}/1000w</span>
                  </Link>
                ))}
              </div>
            </Section>
          </>
        )}
      </div>
    </div>
  )
}

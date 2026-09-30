'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { DOMAINS, type Domain } from '@/lib/style/types'
import { apiGetRun, apiGetA2H01Report, apiGetProject, type BenchmarkRun, type A2H01Report, type CorpusProject } from '@/lib/a2hApi'
import { Spinner } from '@/components/ui/Spinner'

function pct(n: number | null): string {
  return n == null ? '—' : `${(n * 100).toFixed(1)}%`
}
function num(n: number | null, digits = 3): string {
  return n == null ? '—' : n.toFixed(digits)
}

export default function A2H01ResultsPage() {
  const runId = useParams().runId as string

  const [run, setRun] = useState<BenchmarkRun | null>(null)
  const [project, setProject] = useState<CorpusProject | null>(null)
  const [report, setReport] = useState<A2H01Report | null>(null)
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
    apiGetA2H01Report(runId, {
      ...(domainFilter ? { domainId: domainFilter } : {}),
      ...(intensityFilter ? { intensity: intensityFilter } : {}),
    })
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
          <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mt-1">A2H-01 GPTZero AI-to-Human Conversion</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Run: {run?.name} · Corpus: {project?.name}</p>
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
            <p className="text-sm text-gray-500 dark:text-gray-400">N: {report.overall.n.toLocaleString()} outputs</p>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Card label="AI→Human Conversion" value={pct(report.overall.conversionRate.successRate)} sub={`${report.overall.nConverted} / ${report.overall.nEligible} eligible`} />
              <Card label="Mean Δ AI Probability" value={num(report.overall.deltaAiProbability.mean)} sub={`95% CI [${num(report.overall.deltaAiProbability.ciLow95)}, ${num(report.overall.deltaAiProbability.ciHigh95)}]`} />
              <Card label="Median Δ AI Probability" value={num(report.overall.deltaAiProbability.median)} />
              <Card label="Eligible Baseline-AI N" value={String(report.overall.nEligible)} />
            </div>

            <Section title="Conversion by Intensity">
              <BreakdownTable rows={Object.entries(report.byIntensity).map(([k, v]) => ({ key: `Intensity ${k}`, ...v }))} />
            </Section>

            <Section title="Conversion by Domain">
              <BreakdownTable rows={Object.entries(report.byDomain).map(([k, v]) => ({ key: k, ...v }))} />
            </Section>

            <Section title="Conversion by Length">
              <BreakdownTable rows={Object.entries(report.byLength).map(([k, v]) => ({ key: `${k} words`, ...v }))} />
            </Section>

            <Section title="Individual Results">
              <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">Every aggregate above is reproducible from these rows — click any to open its full drilldown.</p>
              <div className="max-h-64 overflow-y-auto space-y-1">
                {report.rows.slice(0, 200).map(row => (
                  <Link key={row.outputId} href={`/admin/a2h/runs/${runId}/outputs/${row.outputId}`}
                    className="flex items-center gap-3 text-xs px-2 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-900/50 transition-colors">
                    <span className="w-16 shrink-0 capitalize text-gray-600 dark:text-gray-400">{row.domainId}</span>
                    <span className="w-14 shrink-0 text-gray-500 dark:text-gray-400">{row.targetWords}w</span>
                    <span className="w-10 shrink-0 text-gray-500 dark:text-gray-400">I{row.intensity}</span>
                    <span className="text-gray-500 dark:text-gray-400">{row.measurements.classificationBefore} → {row.measurements.classificationAfter}</span>
                    <span className="ml-auto text-gray-400 dark:text-gray-500">Δ{num(row.measurements.deltaAiProbability, 2)}</span>
                  </Link>
                ))}
              </div>
              {report.rows.length > 200 && <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Showing first 200 of {report.rows.length.toLocaleString()} rows — narrow with a filter above to see more.</p>}
            </Section>
          </>
        )}
      </div>
    </div>
  )
}

function Card({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="border border-gray-200 dark:border-gray-800 rounded-2xl p-4">
      <p className="text-xs text-gray-400 dark:text-gray-500 uppercase tracking-wider">{label}</p>
      <p className="text-xl font-semibold text-gray-900 dark:text-gray-100 tabular-nums mt-1">{value}</p>
      {sub && <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{sub}</p>}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-gray-200 dark:border-gray-800 rounded-2xl p-4 space-y-2">
      <h2 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">{title}</h2>
      {children}
    </div>
  )
}

interface BreakdownRow {
  key: string
  n: number
  nEligible: number
  nConverted: number
  conversionRate: { successRate: number | null }
  deltaAiProbability: { mean: number | null }
}

function BreakdownTable({ rows }: { rows: BreakdownRow[] }) {
  if (rows.length === 0) return <p className="text-xs text-gray-400 dark:text-gray-500">No data yet.</p>
  const maxRate = Math.max(...rows.map(r => r.conversionRate.successRate ?? 0), 0.01)
  return (
    <div className="space-y-1.5">
      {rows.map(r => (
        <div key={r.key} className="flex items-center gap-3 text-xs">
          <span className="w-24 shrink-0 text-gray-600 dark:text-gray-400">{r.key}</span>
          <div className="flex-1 h-4 bg-gray-100 dark:bg-gray-800 rounded overflow-hidden">
            <div className="h-full bg-blue-500 dark:bg-blue-600" style={{ width: `${((r.conversionRate.successRate ?? 0) / maxRate) * 100}%` }} />
          </div>
          <span className="w-16 text-right tabular-nums text-gray-700 dark:text-gray-300">{pct(r.conversionRate.successRate)}</span>
          <span className="w-20 text-right tabular-nums text-gray-400 dark:text-gray-500">Δ{num(r.deltaAiProbability.mean, 2)}</span>
          <span className="w-14 text-right tabular-nums text-gray-400 dark:text-gray-500">n={r.n}</span>
        </div>
      ))}
    </div>
  )
}

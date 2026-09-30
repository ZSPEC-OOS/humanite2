'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { apiGetRun, apiGetA2H17Report, apiGetProject, type BenchmarkRun, type A2H17Report, type CorpusProject } from '@/lib/a2hApi'
import { Spinner } from '@/components/ui/Spinner'
import { Card, Section, num, pct } from '@/components/a2h/ResultsPageChrome'

function BreakdownList({ data, valueLabel, format }: { data: Record<string, { n: number; value: number | null }>; valueLabel: string; format: (n: number | null) => string }) {
  const entries = Object.entries(data)
  if (entries.length === 0) return <p className="text-xs text-gray-400 dark:text-gray-500">No data yet.</p>
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-3 text-xs text-gray-400 dark:text-gray-500 font-medium">
        <span className="w-24 shrink-0">Group</span><span className="w-24 text-right">{valueLabel}</span><span className="w-16 text-right">n</span>
      </div>
      {entries.map(([key, { n, value }]) => (
        <div key={key} className="flex items-center gap-3 text-xs">
          <span className="w-24 shrink-0 text-gray-600 dark:text-gray-400">{key}</span>
          <span className="w-24 text-right tabular-nums text-gray-700 dark:text-gray-300">{format(value)}</span>
          <span className="w-16 text-right tabular-nums text-gray-400 dark:text-gray-500">{n}</span>
        </div>
      ))}
    </div>
  )
}

export default function A2H17ResultsPage() {
  const runId = useParams().runId as string

  const [run, setRun] = useState<BenchmarkRun | null>(null)
  const [project, setProject] = useState<CorpusProject | null>(null)
  const [report, setReport] = useState<A2H17Report | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    apiGetRun(runId).then(r => { if (!cancelled) { setRun(r); return apiGetProject(r.corpusProjectId) } }).then(p => { if (!cancelled && p) setProject(p) }).catch(() => {})
    return () => { cancelled = true }
  }, [runId])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    apiGetA2H17Report(runId)
      .then(r => { if (!cancelled) setReport(r) })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load report.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [runId])

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950 p-6">
      <div className="max-w-5xl mx-auto space-y-5">
        <div>
          <Link href={`/admin/a2h/runs/${runId}`} className="text-xs text-gray-400 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-300">← {run?.name ?? 'Run'}</Link>
          <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mt-1">A2H-17 Operational Efficiency</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Run: {run?.name} · Corpus: {project?.name} · Aggregated telemetry across every paid operation this run performed.</p>
        </div>

        {error && <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-xl px-4 py-2.5">{error}</div>}

        {loading || !report ? (
          <div className="flex justify-center py-12"><Spinner className="w-6 h-6 border-gray-200 border-t-gray-700 dark:border-gray-700 dark:border-t-gray-300" /></div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Card label="Operations" value={report.overall.n.toLocaleString()} />
              <Card label="Median Latency" value={`${num(report.overall.latencyMs.median, 0)}ms`} />
              <Card label="P95 Latency" value={`${num(report.overall.latencyMs.p95, 0)}ms`} />
              <Card label="P99 Latency" value={`${num(report.overall.latencyMs.p99, 0)}ms`} />
              <Card label="Primary-Generation Model Calls" value={report.overall.modelCalls.total?.toLocaleString() ?? '—'} />
              <Card label="Primary-Generation Tokens" value={((report.overall.inputTokens.total ?? 0) + (report.overall.outputTokens.total ?? 0)).toLocaleString()} />
              <Card label="Estimated Cost" value={report.overall.costUsd.total != null ? `$${report.overall.costUsd.total.toFixed(2)}` : 'unavailable'} />
              <Card label="Pipeline Retry Rate" value={pct(report.overall.pipelineRetries.retryRate)} />
              <Card label="Benchmark Job Retry Rate" value={pct(report.overall.jobRetries.retryRate)} />
              <Card label="Failure Rate" value={pct(report.overall.failures.rate)} />
            </div>
            <p className="text-xs text-gray-400 dark:text-gray-500 -mt-2">
              Model-call and token counts cover primary generation only — internal quality-gate/judge, targeted-repair,
              claim-verification, and document-context/consistency calls are not yet instrumented, so true totals are somewhat
              higher. Pipeline retries (Humanite&apos;s own candidate/quality-gate retries) and benchmark job retries (a
              provider error causing this run&apos;s own job to be re-attempted) are different events, reported separately.
            </p>

            <Section title="Latency by Intensity">
              <BreakdownList data={Object.fromEntries(Object.entries(report.byIntensity).map(([k, v]) => [`I${k}`, { n: v.n, value: v.latencyMs.median }]))} valueLabel="Median (ms)" format={v => num(v, 0)} />
            </Section>

            <Section title="Latency by Length">
              <BreakdownList data={Object.fromEntries(Object.entries(report.byLength).map(([k, v]) => [`${k}w`, { n: v.n, value: v.latencyMs.median }]))} valueLabel="Median (ms)" format={v => num(v, 0)} />
            </Section>

            <Section title="Cost by Intensity">
              <BreakdownList data={Object.fromEntries(Object.entries(report.byIntensity).map(([k, v]) => [`I${k}`, { n: v.n, value: v.costUsd.total }]))} valueLabel="Total ($)" format={v => (v != null ? `$${v.toFixed(2)}` : '—')} />
            </Section>

            <Section title="Token Usage by Length">
              <BreakdownList
                data={Object.fromEntries(Object.entries(report.byLength).map(([k, v]) => [`${k}w`, { n: v.n, value: (v.inputTokens.total ?? 0) + (v.outputTokens.total ?? 0) }]))}
                valueLabel="Total Tokens" format={v => num(v, 0)}
              />
            </Section>

            <Section title="Failure Rate by Operation">
              <BreakdownList data={Object.fromEntries(Object.entries(report.byOperationType).map(([k, v]) => [k, { n: v.n, value: v.failures.rate }]))} valueLabel="Failure Rate" format={pct} />
            </Section>
          </>
        )}
      </div>
    </div>
  )
}

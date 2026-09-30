'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { apiGetRun, apiGetA2H06Report, apiGetProject, type BenchmarkRun, type A2H06Report, type CorpusProject } from '@/lib/a2hApi'
import { Spinner } from '@/components/ui/Spinner'
import { Card, Section, RateBreakdownTable, pct, num } from '@/components/a2h/ResultsPageChrome'

// Fixture-scoped (§9/§36) — every row here is one grammar_repair fixture's
// repair outcome, not an output; there is no domain/length/intensity filter
// since a fixture carries none of those dimensions.
export default function A2H06ResultsPage() {
  const runId = useParams().runId as string

  const [run, setRun] = useState<BenchmarkRun | null>(null)
  const [project, setProject] = useState<CorpusProject | null>(null)
  const [report, setReport] = useState<A2H06Report | null>(null)
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
    apiGetA2H06Report(runId)
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
          <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mt-1">A2H-06 Grammar Repair</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Run: {run?.name} · Corpus: {project?.name} · Fixture version: {run?.fixtureVersion ?? '—'} · Repair config: {run?.repairConfigVersion ?? '—'}
          </p>
        </div>

        {error && <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-xl px-4 py-2.5">{error}</div>}

        {loading || !report ? (
          <div className="flex justify-center py-12"><Spinner className="w-6 h-6 border-gray-200 border-t-gray-700 dark:border-gray-700 dark:border-t-gray-300" /></div>
        ) : (
          <>
            <p className="text-sm text-gray-500 dark:text-gray-400">Fixtures evaluated: {report.overall.n.toLocaleString()}</p>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Card label="Grammar Repair Rate" value={pct(report.overall.repairRate.successRate)} sub={`${report.overall.repairRate.successCount} / ${report.overall.repairRate.n} fixtures`} />
              <Card label="Fixtures Evaluated" value={report.overall.n.toLocaleString()} />
              <Card label="Corrected" value={num(report.overall.repairRate.successCount)} />
              <Card label="Remaining" value={num(report.overall.remainingErrorCount)} />
              <Card label="Partial" value={num(report.overall.partialCorrectionCount)} />
              <Card label="New Errors Introduced" value={num(report.overall.newErrorCount)} />
            </div>

            <Section title="Repair Rate by Grammar Category">
              <RateBreakdownTable rows={Object.entries(report.byCategory).map(([k, v]) => ({ key: k, rate: v.repairRate.successRate, n: v.n }))} />
            </Section>

            <Section title="Fixture Results">
              <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">Every row is one grammar_repair fixture&apos;s repair attempt, scored deterministically against its known clean/corrupted text.</p>
              <div className="max-h-80 overflow-y-auto space-y-1">
                {report.fixtures.map(f => (
                  <div key={f.fixtureId} className="flex items-center gap-3 text-xs px-2 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-900/50 transition-colors">
                    <span className="w-40 shrink-0 text-gray-600 dark:text-gray-400 truncate">{f.category}</span>
                    <span className={
                      f.status === 'corrected' ? 'text-green-700 dark:text-green-400'
                        : f.status === 'not_corrected' ? 'text-red-600 dark:text-red-400'
                          : 'text-amber-600 dark:text-amber-400'
                    }>
                      {f.status}
                    </span>
                    {f.newErrorIntroduced && <span className="text-red-500 dark:text-red-400">new error</span>}
                    <span className="ml-auto text-gray-400 dark:text-gray-500 truncate max-w-xs">{f.repairedText}</span>
                  </div>
                ))}
              </div>
            </Section>
          </>
        )}
      </div>
    </div>
  )
}

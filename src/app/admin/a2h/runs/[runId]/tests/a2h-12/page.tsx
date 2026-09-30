'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { apiGetRun, apiGetA2H12Report, apiGetProject, type BenchmarkRun, type A2H12Report, type CorpusProject } from '@/lib/a2hApi'
import { Spinner } from '@/components/ui/Spinner'
import { Card, Section, RateBreakdownTable, pct, num } from '@/components/a2h/ResultsPageChrome'

// High-risk categories (§38) get their own visibility, matching the spec's
// explicit call-out — sign reversal, unit substitution, range corruption,
// scientific-notation corruption, and negation reversal are the categories
// where a wrong repair is most consequential.
const HIGH_RISK_CATEGORIES = new Set(['sign_reversal', 'unit_substitution', 'range_corruption', 'scientific_notation_corruption', 'negation_deletion'])

export default function A2H12ResultsPage() {
  const runId = useParams().runId as string

  const [run, setRun] = useState<BenchmarkRun | null>(null)
  const [project, setProject] = useState<CorpusProject | null>(null)
  const [report, setReport] = useState<A2H12Report | null>(null)
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
    apiGetA2H12Report(runId)
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
          <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mt-1">A2H-12 Factual Repair Success</h1>
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
              <Card label="Factual Repair Success" value={pct(report.overall.repairRate.successRate)} sub={`${report.overall.repairRate.successCount} / ${report.overall.repairRate.n} fixtures`} />
              <Card label="Fixtures Evaluated" value={report.overall.n.toLocaleString()} />
              <Card label="Fully Repaired" value={num(report.overall.repairRate.successCount)} />
              <Card label="Partially Repaired" value={num(report.overall.partialRepairCount)} />
              <Card label="Failed" value={num(report.overall.n - report.overall.repairRate.successCount - report.overall.partialRepairCount - report.overall.newCorruptionCount)} />
              <Card label="New Corruptions" value={num(report.overall.newCorruptionCount)} />
            </div>

            <Section title="Repair Success by Corruption Type">
              <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">
                High-risk categories are marked — a wrong repair there is the most consequential failure mode.
              </p>
              <RateBreakdownTable
                rows={Object.entries(report.byCategory).map(([k, v]) => ({ key: HIGH_RISK_CATEGORIES.has(k) ? `⚠ ${k}` : k, rate: v.repairRate.successRate, n: v.n }))}
              />
            </Section>

            <Section title="Fixture Results">
              <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">Every row is one factual_repair fixture, scored deterministically — binding-aware, never a plain &quot;value appears somewhere&quot; check.</p>
              <div className="max-h-80 overflow-y-auto space-y-1">
                {report.fixtures.map(f => (
                  <div key={f.fixtureId} className="flex items-center gap-3 text-xs px-2 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-900/50 transition-colors">
                    <span className={`w-48 shrink-0 truncate ${HIGH_RISK_CATEGORIES.has(f.category) ? 'text-amber-600 dark:text-amber-400 font-medium' : 'text-gray-600 dark:text-gray-400'}`}>{f.category}</span>
                    <span className={
                      f.status === 'fully_repaired' ? 'text-green-700 dark:text-green-400'
                        : f.status === 'not_repaired' ? 'text-red-600 dark:text-red-400'
                          : f.status === 'new_corruption' ? 'text-red-500 dark:text-red-400'
                            : 'text-amber-600 dark:text-amber-400'
                    }>
                      {f.status}
                    </span>
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

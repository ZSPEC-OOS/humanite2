'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { apiGetRun, apiGetA2H15Report, apiGetProject, type BenchmarkRun, type A2H15Report, type CorpusProject } from '@/lib/a2hApi'
import { Spinner } from '@/components/ui/Spinner'
import { Card, Section, DeltaComparisonTable, type DeltaRow, pct } from '@/components/a2h/ResultsPageChrome'

function meanOf(values: Array<number | null>): number | null {
  const present = values.filter((v): v is number => v != null)
  return present.length === 0 ? null : present.reduce((a, b) => a + b, 0) / present.length
}

export default function A2H15ResultsPage() {
  const runId = useParams().runId as string

  const [run, setRun] = useState<BenchmarkRun | null>(null)
  const [project, setProject] = useState<CorpusProject | null>(null)
  const [report, setReport] = useState<A2H15Report | null>(null)
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
    apiGetA2H15Report(runId)
      .then(r => { if (!cancelled) setReport(r) })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load report.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [runId])

  const rows: DeltaRow[] = report ? [
    { key: 'GPTZero AI probability', left: meanOf(report.pairs.map(p => p.aiProbability.single)), right: meanOf(report.pairs.map(p => p.aiProbability.production)), delta: report.overall.aiProbabilityDelta.mean, digits: 3 },
    { key: 'Transformation magnitude', left: meanOf(report.pairs.map(p => p.transformationMagnitude.single)), right: meanOf(report.pairs.map(p => p.transformationMagnitude.production)), delta: report.overall.transformationMagnitudeDelta.mean, digits: 3 },
    { key: 'Grammar damage (new/1000w)', left: meanOf(report.pairs.map(p => p.grammarDamageNewErrorsPer1000.single)), right: meanOf(report.pairs.map(p => p.grammarDamageNewErrorsPer1000.production)), delta: report.overall.grammarDamageDelta.mean, digits: 2 },
    { key: 'Latency (ms)', left: meanOf(report.pairs.map(p => p.latencyMs.single)), right: meanOf(report.pairs.map(p => p.latencyMs.production)), delta: report.overall.latencyDeltaMs.mean, digits: 0 },
    { key: 'Model calls', left: meanOf(report.pairs.map(p => p.modelCalls.single)), right: meanOf(report.pairs.map(p => p.modelCalls.production)), delta: report.overall.modelCallsDelta.mean, digits: 2 },
    { key: 'Input tokens', left: meanOf(report.pairs.map(p => p.inputTokens.single)), right: meanOf(report.pairs.map(p => p.inputTokens.production)), delta: null, digits: 0 },
    { key: 'Output tokens', left: meanOf(report.pairs.map(p => p.outputTokens.single)), right: meanOf(report.pairs.map(p => p.outputTokens.production)), delta: null, digits: 0 },
    { key: 'Estimated cost (USD)', left: meanOf(report.pairs.map(p => p.estimatedCostUsd.single)), right: meanOf(report.pairs.map(p => p.estimatedCostUsd.production)), delta: null, digits: 4 },
  ] : []

  const preservationCodes = report ? [...new Set(report.pairs.flatMap(p => Object.keys(p.preservation)))] : []

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950 p-6">
      <div className="max-w-5xl mx-auto space-y-5">
        <div>
          <Link href={`/admin/a2h/runs/${runId}`} className="text-xs text-gray-400 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-300">← {run?.name ?? 'Run'}</Link>
          <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mt-1">A2H-15 Candidate Selection Effectiveness</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Run: {run?.name} · Corpus: {project?.name} · Single-candidate baseline vs production multi-candidate search, matched conditions.</p>
        </div>

        {error && <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-xl px-4 py-2.5">{error}</div>}

        {loading || !report ? (
          <div className="flex justify-center py-12"><Spinner className="w-6 h-6 border-gray-200 border-t-gray-700 dark:border-gray-700 dark:border-t-gray-300" /></div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Card label="Pairs Evaluated" value={report.overall.n.toLocaleString()} />
              <Card label="Candidate Rejection Rate" value={pct(report.overall.candidateRejectionRate)} />
              <Card label="All-Disqualified Rate" value={pct(report.overall.allDisqualifiedRate)} />
              <Card label="Mean Latency Δ (ms)" value={report.overall.latencyDeltaMs.mean?.toFixed(0) ?? '—'} />
            </div>

            <Section title="Multi-Candidate vs Single — Paired Deltas">
              <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">Public/objective metrics only — no single winner label.</p>
              <DeltaComparisonTable rows={rows} leftLabel="Single" rightLabel="Production" />
            </Section>

            {preservationCodes.length > 0 && (
              <Section title="Preservation Deltas (fixture-backed, where coverage exists)">
                <DeltaComparisonTable
                  rows={preservationCodes.map(code => ({
                    key: code,
                    left: meanOf(report.pairs.map(p => p.preservation[code as keyof typeof p.preservation]?.single ?? null)),
                    right: meanOf(report.pairs.map(p => p.preservation[code as keyof typeof p.preservation]?.production ?? null)),
                    delta: meanOf(report.pairs.map(p => p.preservation[code as keyof typeof p.preservation]?.delta ?? null)),
                    digits: 3,
                  }))}
                  leftLabel="Single"
                  rightLabel="Production"
                />
              </Section>
            )}

            {Object.keys(report.overall.disqualifiedByStage).length > 0 && (
              <Section title="Rejections By Stage">
                <div className="space-y-1">
                  {Object.entries(report.overall.disqualifiedByStage).map(([stage, count]) => (
                    <div key={stage} className="flex justify-between text-xs">
                      <span className="text-gray-600 dark:text-gray-400">{stage}</span>
                      <span className="tabular-nums text-gray-800 dark:text-gray-200 font-semibold">{count}</span>
                    </div>
                  ))}
                </div>
              </Section>
            )}
          </>
        )}
      </div>
    </div>
  )
}

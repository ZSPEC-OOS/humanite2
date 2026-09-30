'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { apiGetRun, apiGetA2H14Report, apiGetProject, type BenchmarkRun, type A2H14Report, type CorpusProject } from '@/lib/a2hApi'
import { Spinner } from '@/components/ui/Spinner'
import { Section, num, pct } from '@/components/a2h/ResultsPageChrome'
import type { StyleToneMetricAggregate } from '@/lib/a2h/styleContrastShared'

export default function A2H14ResultsPage() {
  const runId = useParams().runId as string

  const [run, setRun] = useState<BenchmarkRun | null>(null)
  const [project, setProject] = useState<CorpusProject | null>(null)
  const [report, setReport] = useState<A2H14Report | null>(null)
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
    apiGetA2H14Report(runId)
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
          <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mt-1">A2H-14 Genre/Audience Control</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Run: {run?.name} · Corpus: {project?.name} · Deterministic readability/structure metrics — no subjective genre classifier.</p>
        </div>

        {error && <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-xl px-4 py-2.5">{error}</div>}

        {loading || !report ? (
          <div className="flex justify-center py-12"><Spinner className="w-6 h-6 border-gray-200 border-t-gray-700 dark:border-gray-700 dark:border-t-gray-300" /></div>
        ) : report.contrasts.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-500 py-12 text-center">No genre/audience contrasts configured for this run.</p>
        ) : (
          report.contrasts.map(contrast => {
            const rows: Array<{ key: string; metric: StyleToneMetricAggregate; digits: number }> = [
              { key: 'Readability (Flesch)', metric: contrast.readability, digits: 1 },
              { key: 'Sentence length', metric: contrast.averageSentenceLength, digits: 1 },
              { key: 'Lexical complexity', metric: contrast.lexicalComplexity, digits: 3 },
              { key: 'Paragraph length', metric: contrast.paragraphLength, digits: 1 },
              { key: 'First-person rate', metric: contrast.firstPersonRate, digits: 3 },
            ]
            return (
              <Section key={contrast.contrastId} title={contrast.label}>
                <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">{contrast.n} matched source pairs. Each metric independent.</p>
                <div className="space-y-1">
                  <div className="flex items-center gap-3 text-xs text-gray-400 dark:text-gray-500 font-medium">
                    <span className="w-36 shrink-0">Metric</span><span className="w-24 text-right">Mean Δ</span><span className="w-32 text-right">Moved Expected Dir.</span>
                  </div>
                  {rows.map(r => (
                    <div key={r.key} className="flex items-center gap-3 text-xs">
                      <span className="w-36 shrink-0 text-gray-600 dark:text-gray-400">{r.key}</span>
                      <span className="w-24 text-right tabular-nums text-gray-700 dark:text-gray-300">{num(r.metric.meanDelta, r.digits)}</span>
                      <span className="w-32 text-right tabular-nums font-medium text-gray-800 dark:text-gray-200">{pct(r.metric.pctMovedExpectedDirection)}</span>
                    </div>
                  ))}
                </div>
              </Section>
            )
          })
        )}
      </div>
    </div>
  )
}

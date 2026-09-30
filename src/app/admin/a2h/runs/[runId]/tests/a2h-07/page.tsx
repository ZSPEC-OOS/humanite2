'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { apiGetRun, apiGetA2H07Report, apiGetProject, type BenchmarkRun, type A2H07Report, type CorpusProject } from '@/lib/a2hApi'
import { Spinner } from '@/components/ui/Spinner'
import { Card, Section, num, pct } from '@/components/a2h/ResultsPageChrome'

export default function A2H07ResultsPage() {
  const runId = useParams().runId as string

  const [run, setRun] = useState<BenchmarkRun | null>(null)
  const [project, setProject] = useState<CorpusProject | null>(null)
  const [report, setReport] = useState<A2H07Report | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedCondition, setExpandedCondition] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    apiGetRun(runId).then(r => { if (!cancelled) { setRun(r); return apiGetProject(r.corpusProjectId) } }).then(p => { if (!cancelled && p) setProject(p) }).catch(() => {})
    return () => { cancelled = true }
  }, [runId])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    apiGetA2H07Report(runId)
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
          <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mt-1">A2H-07 Repeatability</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Run: {run?.name} · Corpus: {project?.name} · Same source + intensity + configuration, executed repeatedly.
          </p>
        </div>

        {error && <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-xl px-4 py-2.5">{error}</div>}

        {loading || !report ? (
          <div className="flex justify-center py-12"><Spinner className="w-6 h-6 border-gray-200 border-t-gray-700 dark:border-gray-700 dark:border-t-gray-300" /></div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <Card label="Conditions Evaluated" value={report.conditionsEvaluated.toLocaleString()} />
              <Card label="Repeats / Condition" value={report.repeatsPerCondition?.toLocaleString() ?? '—'} />
              <Card label="Mean GPTZero CV" value={pct(report.meanAiProbabilityCv)} />
              <Card label="Classification Agreement" value={pct(report.meanClassificationAgreement)} />
              <Card label="Mean Magnitude CV" value={pct(report.meanTransformationMagnitudeCv)} />
            </div>

            <Section title="Conditions">
              <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">Descriptive variance per repeated condition — never one opaque repeatability score.</p>
              <div className="space-y-1.5">
                {report.conditions.map(c => (
                  <div key={`${c.sourceId}__${c.conditionId}`} className="border border-gray-100 dark:border-gray-900 rounded-xl">
                    <button onClick={() => setExpandedCondition(prev => (prev === c.conditionId ? null : c.conditionId))}
                      className="w-full flex items-center gap-3 text-xs px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-900/50 transition-colors">
                      <span className="w-40 shrink-0 truncate text-gray-600 dark:text-gray-400">{c.sourceId} / I{c.intensity}</span>
                      <span className="w-16 text-gray-500 dark:text-gray-400">n={c.n}</span>
                      <span className="w-32 text-gray-500 dark:text-gray-400">CV(AI) {pct(c.aiProbabilityCv)}</span>
                      <span className="w-32 text-gray-500 dark:text-gray-400">Agree {pct(c.classificationAgreement)}</span>
                      <span className="ml-auto text-gray-400 dark:text-gray-500">{c.uniqueOutputCount} unique / {c.identicalOutputCount} identical</span>
                    </button>
                    {expandedCondition === c.conditionId && (
                      <div className="px-3 pb-2 space-y-1">
                        <div className="flex items-center gap-3 text-xs text-gray-400 dark:text-gray-500 font-medium">
                          <span className="w-16">Repeat</span><span className="w-20 text-right">AI Prob</span><span className="w-28 text-right">Classification</span><span className="w-20 text-right">Magnitude</span>
                        </div>
                        {c.trials.map(t => (
                          <div key={t.trialIndex} className="flex items-center gap-3 text-xs">
                            <span className="w-16 text-gray-600 dark:text-gray-400">{t.trialIndex + 1}</span>
                            <span className="w-20 text-right tabular-nums text-gray-700 dark:text-gray-300">{num(t.aiProbability, 2)}</span>
                            <span className="w-28 text-right text-gray-700 dark:text-gray-300">{t.classification ?? '—'}</span>
                            <span className="w-20 text-right tabular-nums text-gray-700 dark:text-gray-300">{num(t.transformationMagnitude, 2)}</span>
                          </div>
                        ))}
                      </div>
                    )}
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

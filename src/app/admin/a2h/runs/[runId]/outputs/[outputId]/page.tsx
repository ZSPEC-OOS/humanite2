'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { apiGetOutputDetail, type OutputDetail } from '@/lib/a2hApi'
import { Spinner } from '@/components/ui/Spinner'

function pct(n: number | null | undefined): string {
  return n == null ? '—' : `${(n * 100).toFixed(1)}%`
}

// The reusable document-detail drilldown (§20) — every aggregate/chart in
// the results pages must be traceable back to a record exactly like this
// one: source → output → detector result, all read from already-persisted
// rows.
export default function OutputDrilldownPage() {
  const params = useParams()
  const runId = params.runId as string
  const outputId = params.outputId as string

  const [detail, setDetail] = useState<OutputDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    apiGetOutputDetail(runId, outputId)
      .then(d => { if (!cancelled) setDetail(d) })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load output.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [runId, outputId])

  if (loading) {
    return <div className="min-h-screen bg-white dark:bg-gray-950 flex items-center justify-center"><Spinner className="w-6 h-6 border-gray-200 border-t-gray-700 dark:border-gray-700 dark:border-t-gray-300" /></div>
  }
  if (error || !detail) {
    return <div className="min-h-screen bg-white dark:bg-gray-950 p-6 text-sm text-red-600 dark:text-red-400">{error ?? 'Output not found.'}</div>
  }

  const { output, source, topic, baseline, postScore } = detail
  const deltaAi = baseline?.aiProbability != null && postScore?.aiProbability != null ? baseline.aiProbability - postScore.aiProbability : null

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950 p-6">
      <div className="max-w-4xl mx-auto space-y-5">
        <div>
          <Link href={`/admin/a2h/runs/${runId}/tests/a2h-01`} className="text-xs text-gray-400 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-300">← Back to results</Link>
          <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mt-1">{topic.title} · {output.targetWords} words · Intensity {output.intensity}</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{output.domainId} · {output.model}</p>
        </div>

        <Section title="Source">
          <dl className="grid grid-cols-2 gap-2 text-xs">
            <Field label="Corpus source ID" value={source.id} mono />
            <Field label="Topic" value={topic.title} />
            <Field label="Domain" value={source.domainId} />
            <Field label="Target words" value={String(source.targetWords)} />
            <Field label="Actual source words" value={String(source.actualWords)} />
            <Field label="Source SHA-256" value={source.sha256} mono />
          </dl>
        </Section>

        <Section title="Humanized Output">
          <dl className="grid grid-cols-2 gap-2 text-xs mb-3">
            <Field label="Output SHA-256" value={output.outputSha256 || '—'} mono />
            <Field label="Output words" value={String(output.outputWords)} />
            <Field label="Status" value={output.status} />
            <Field label="Latency" value={`${output.latencyMs}ms`} />
            <Field label="Retries" value={String(output.retryCount)} />
            <Field label="Candidate count" value={output.candidateCount != null ? String(output.candidateCount) : '—'} />
            <Field label="Input tokens" value={output.inputTokens != null ? String(output.inputTokens) : 'not available'} />
            <Field label="Output tokens" value={output.outputTokens != null ? String(output.outputTokens) : 'not available'} />
            <Field label="Estimated cost" value={output.estimatedCostUsd != null ? `$${output.estimatedCostUsd.toFixed(4)}` : 'not available'} />
          </dl>
          {output.status === 'success' ? (
            <pre className="text-sm text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-900/50 rounded-xl p-3 whitespace-pre-wrap max-h-64 overflow-y-auto">{output.outputText}</pre>
          ) : (
            <p className="text-xs text-red-600 dark:text-red-400">{output.errorCode}: {output.errorMessage}</p>
          )}
        </Section>

        <Section title="GPTZero">
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div>
              <p className="text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1">Before</p>
              {baseline ? (
                <p className="text-gray-700 dark:text-gray-300">{baseline.classification} · AI {pct(baseline.aiProbability)} · Human {pct(baseline.humanProbability)}</p>
              ) : <p className="text-gray-400 dark:text-gray-500">Not yet acquired</p>}
            </div>
            <div>
              <p className="text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1">After</p>
              {postScore ? (
                <p className="text-gray-700 dark:text-gray-300">{postScore.classification} · AI {pct(postScore.aiProbability)} · Human {pct(postScore.humanProbability)}</p>
              ) : <p className="text-gray-400 dark:text-gray-500">Not yet acquired</p>}
            </div>
          </div>
          {deltaAi != null && <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">Δ AI probability: {(deltaAi * 100).toFixed(1)} points</p>}
        </Section>

        <Section title="Raw Data">
          <details className="text-xs">
            <summary className="cursor-pointer text-gray-500 dark:text-gray-400">Raw baseline GPTZero payload</summary>
            <pre className="mt-2 bg-gray-50 dark:bg-gray-900/50 rounded-xl p-3 overflow-x-auto max-h-48">{JSON.stringify(baseline?.rawResponse ?? null, null, 2)}</pre>
          </details>
          <details className="text-xs mt-2">
            <summary className="cursor-pointer text-gray-500 dark:text-gray-400">Raw post-transform GPTZero payload</summary>
            <pre className="mt-2 bg-gray-50 dark:bg-gray-900/50 rounded-xl p-3 overflow-x-auto max-h-48">{JSON.stringify(postScore?.rawResponse ?? null, null, 2)}</pre>
          </details>
          <details className="text-xs mt-2">
            <summary className="cursor-pointer text-gray-500 dark:text-gray-400">Raw source text</summary>
            <pre className="mt-2 bg-gray-50 dark:bg-gray-900/50 rounded-xl p-3 whitespace-pre-wrap max-h-48 overflow-y-auto">{source.text}</pre>
          </details>
        </Section>
      </div>
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

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-gray-400 dark:text-gray-500">{label}</dt>
      <dd className={`text-gray-700 dark:text-gray-300 ${mono ? 'font-mono truncate' : ''}`}>{value}</dd>
    </div>
  )
}

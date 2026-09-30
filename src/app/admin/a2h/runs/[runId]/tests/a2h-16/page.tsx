'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import {
  apiGetRun, apiGetA2H16Report, apiGetProject, apiGetClaimVerifierCalibration, apiRunClaimVerifierCalibration,
  type BenchmarkRun, type A2H16Report, type CorpusProject, type ClaimVerifierCalibrationResult,
} from '@/lib/a2hApi'
import { Spinner } from '@/components/ui/Spinner'
import { Card, Section, pct } from '@/components/a2h/ResultsPageChrome'

export default function A2H16ResultsPage() {
  const runId = useParams().runId as string

  const [run, setRun] = useState<BenchmarkRun | null>(null)
  const [project, setProject] = useState<CorpusProject | null>(null)
  const [report, setReport] = useState<A2H16Report | null>(null)
  const [calibration, setCalibration] = useState<ClaimVerifierCalibrationResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [calibrating, setCalibrating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    apiGetRun(runId).then(r => { if (!cancelled) { setRun(r); return apiGetProject(r.corpusProjectId) } }).then(p => { if (!cancelled && p) setProject(p) }).catch(() => {})
    return () => { cancelled = true }
  }, [runId])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([apiGetA2H16Report(runId), apiGetClaimVerifierCalibration().catch(() => null)])
      .then(([r, c]) => { if (!cancelled) { setReport(r); setCalibration(c) } })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load report.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [runId])

  async function handleRunCalibration() {
    setCalibrating(true)
    setError(null)
    try {
      setCalibration(await apiRunClaimVerifierCalibration(false))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Calibration failed.')
    } finally {
      setCalibrating(false)
    }
  }

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950 p-6">
      <div className="max-w-5xl mx-auto space-y-5">
        <div>
          <Link href={`/admin/a2h/runs/${runId}`} className="text-xs text-gray-400 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-300">← {run?.name ?? 'Run'}</Link>
          <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mt-1">A2H-16 Claim-Relationship Preservation</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Run: {run?.name} · Corpus: {project?.name} · Deterministic ground truth — never a generative judge.</p>
        </div>

        {error && <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-xl px-4 py-2.5">{error}</div>}

        {loading || !report ? (
          <div className="flex justify-center py-12"><Spinner className="w-6 h-6 border-gray-200 border-t-gray-700 dark:border-gray-700 dark:border-t-gray-300" /></div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Card label="Claim Relationship Preservation" value={pct(report.overall.preservationRate)} sub={`${report.overall.preservedCount} / ${report.overall.fixtureCount} claims`} />
              <Card label="Fixtures Evaluated" value={report.overall.fixtureCount.toLocaleString()} />
              <Card label="Corrupted Relationships" value={report.overall.corruptedCount.toLocaleString()} />
              <Card label="Uncertain" value={report.overall.uncertainCount.toLocaleString()} />
              <Card label="Known-Corruption Detection" value={calibration ? pct(calibration.knownCorruptionDetectionRate) : '—'} sub="verifier calibration" />
              <Card label="Verifier False-Failure Rate" value={calibration ? pct(calibration.falseFailureRate) : '—'} sub="verifier calibration" />
            </div>

            <Section title="Preservation By Category">
              <div className="space-y-1">
                {Object.entries(report.byCategory).map(([category, stats]) => (
                  <div key={category} className="flex items-center gap-3 text-xs">
                    <span className="w-32 shrink-0 text-gray-600 dark:text-gray-400">{category}</span>
                    <span className="text-green-700 dark:text-green-400">{stats.preservedCount} preserved</span>
                    <span className="text-red-600 dark:text-red-400">{stats.corruptedCount} corrupted</span>
                    <span className="text-amber-600 dark:text-amber-400">{stats.uncertainCount} uncertain</span>
                    <span className="ml-auto text-gray-400 dark:text-gray-500">n={stats.n}</span>
                  </div>
                ))}
                {Object.keys(report.byCategory).length === 0 && <p className="text-xs text-gray-400 dark:text-gray-500">No claim_relationship fixture coverage yet.</p>}
              </div>
            </Section>

            <Section title="Fixture Drilldown">
              <div className="max-h-80 overflow-y-auto space-y-1">
                {report.rows.flatMap(row => row.measurements.results.map(r => (
                  <Link key={`${row.outputId}__${r.fixtureId}`} href={`/admin/a2h/runs/${runId}/outputs/${row.outputId}`}
                    className="flex items-center gap-3 text-xs px-2 py-1.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-900/50 transition-colors">
                    <span className="w-32 shrink-0 text-gray-600 dark:text-gray-400">{r.category}</span>
                    <span className={r.status === 'preserved' ? 'text-green-700 dark:text-green-400' : r.status === 'corrupted' ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'}>{r.status}</span>
                    <span className="ml-auto text-gray-400 dark:text-gray-500">{row.domainId} · {row.targetWords}w · I{row.intensity}</span>
                  </Link>
                )))}
              </div>
            </Section>

            <Section title="Verifier Calibration">
              <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">
                Tests the model-based claim verifier itself against a fixed known-correct/known-corrupted dataset — global,
                independent of this run&apos;s corpus. Never treated as this test&apos;s primary ground truth.
              </p>
              {calibration ? (
                <div className="text-xs space-y-1">
                  <p>Model: {calibration.verifierModel} · Config: {calibration.verifierConfigVersion} · Computed {new Date(calibration.computedAt).toLocaleString()}</p>
                  <p>Known-corruption detection rate: {pct(calibration.knownCorruptionDetectionRate)}</p>
                  <p>False-failure rate on known-correct rewrites: {pct(calibration.falseFailureRate)}</p>
                </div>
              ) : (
                <p className="text-xs text-gray-400 dark:text-gray-500">Calibration has not been run yet.</p>
              )}
              <button onClick={handleRunCalibration} disabled={calibrating}
                className="text-xs px-3 py-1.5 rounded-lg bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900 disabled:opacity-40 mt-2">
                {calibrating ? 'Running…' : calibration ? 'Re-run Calibration' : 'Run Calibration'}
              </button>
            </Section>
          </>
        )}
      </div>
    </div>
  )
}

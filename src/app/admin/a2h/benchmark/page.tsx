'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import type { Domain } from '@/lib/style/types'
import {
  apiGetProject, apiListTopics, apiListCorpus,
  apiListBaselines, apiAcquireBaseline,
  apiListOutputs, apiTransformSource, apiListPostScores, apiAcquirePostScore,
  type BenchmarkTopic, type CorpusSource, type BenchmarkOutput, type DetectorResult, type CorpusProject,
} from '@/lib/a2hApi'
import { Spinner } from '@/components/ui/Spinner'

const INTENSITIES = Array.from({ length: 10 }, (_, i) => i + 1)

const OUTPUT_CELL_STYLES: Record<string, string> = {
  empty: 'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-600',
  success: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  failed: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
}

function cellKey(topicId: string, targetWords: number): string {
  return `${topicId}__${targetWords}`
}

function formatPct(value: number | null): string {
  return value == null ? '—' : `${Math.round(value * 100)}%`
}

// Benchmark execution — GPTZero baseline, intensity transformation, and
// post-transform scoring — deliberately lives here rather than on the
// Corpus Matrix. The corpus ends at the frozen source document; everything
// below runs the actual A2H measurement against that frozen, immutable
// input, so it only ever operates on already-frozen sources.
export default function A2HBenchmarkPage() {
  const projectId = useSearchParams().get('project') ?? ''

  const [project, setProject] = useState<CorpusProject | null>(null)
  const [domain, setDomain] = useState<Domain | null>(null)
  const [topics, setTopics] = useState<BenchmarkTopic[]>([])
  const [sources, setSources] = useState<Record<string, CorpusSource>>({})
  const [baselines, setBaselines] = useState<Record<string, DetectorResult>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<{ topic: BenchmarkTopic; targetWords: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [outputs, setOutputs] = useState<Record<number, BenchmarkOutput>>({})
  const [postScores, setPostScores] = useState<Record<string, DetectorResult>>({})
  const [selectedIntensity, setSelectedIntensity] = useState<number | null>(null)
  const [outputsLoading, setOutputsLoading] = useState(false)

  useEffect(() => {
    if (!projectId) { setError('No corpus project selected.'); setLoading(false); return }
    let cancelled = false
    apiGetProject(projectId)
      .then(p => { if (!cancelled) { setProject(p); setDomain(prev => prev ?? p.domains[0] ?? null) } })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load corpus project.') })
    return () => { cancelled = true }
  }, [projectId])

  useEffect(() => {
    if (!projectId || !domain) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setSelected(null)
    Promise.all([apiListTopics(projectId, domain), apiListCorpus(projectId, domain), apiListBaselines(projectId, domain)])
      .then(([topicsData, sourcesData, baselinesData]) => {
        if (cancelled) return
        setTopics(topicsData)
        const map: Record<string, CorpusSource> = {}
        for (const s of sourcesData) if (s.status === 'frozen') map[cellKey(s.topicId, s.targetWords)] = s
        setSources(map)
        setBaselines(baselinesData)
      })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load benchmark data.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [projectId, domain])

  const selectedSource = selected ? sources[cellKey(selected.topic.id, selected.targetWords)] : undefined
  const selectedBaseline = selectedSource ? baselines[selectedSource.id] : undefined

  useEffect(() => {
    setOutputs({})
    setPostScores({})
    setSelectedIntensity(null)
    if (!projectId || !selected || !selectedSource) return
    let cancelled = false
    setOutputsLoading(true)
    apiListOutputs(projectId, selected.topic.id, selected.targetWords)
      .then(async outputsData => {
        if (cancelled) return
        const map: Record<number, BenchmarkOutput> = {}
        for (const o of outputsData) map[o.intensity] = o
        setOutputs(map)
        if (outputsData.length > 0) {
          const scores = await apiListPostScores(projectId, selected.topic.id, selected.targetWords)
          if (!cancelled) setPostScores(scores)
        }
      })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load outputs.') })
      .finally(() => { if (!cancelled) setOutputsLoading(false) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, selected?.topic.id, selected?.targetWords, selectedSource?.id])

  const selectedOutput = selectedIntensity != null ? outputs[selectedIntensity] : undefined
  const selectedPostScore = selectedOutput ? postScores[selectedOutput.id] : undefined

  async function handleAcquireBaseline(force: boolean) {
    if (!selected || !selectedSource) return
    setBusy(true)
    setError(null)
    try {
      const baseline = await apiAcquireBaseline(projectId, selected.topic.id, selected.targetWords, force)
      setBaselines(prev => ({ ...prev, [baseline.sourceId]: baseline }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Baseline acquisition failed.')
    } finally {
      setBusy(false)
    }
  }

  async function handleTransform(force: boolean) {
    if (!selected || selectedIntensity == null) return
    setBusy(true)
    setError(null)
    try {
      const output = await apiTransformSource(projectId, selected.topic.id, selected.targetWords, selectedIntensity, force)
      setOutputs(prev => ({ ...prev, [output.intensity]: output }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transformation failed.')
    } finally {
      setBusy(false)
    }
  }

  async function handleAcquirePostScore(force: boolean) {
    if (!selected || selectedIntensity == null) return
    setBusy(true)
    setError(null)
    try {
      const postScore = await apiAcquirePostScore(projectId, selected.topic.id, selected.targetWords, selectedIntensity, force)
      setPostScores(prev => ({ ...prev, [postScore.outputId ?? postScore.id]: postScore }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Post-score acquisition failed.')
    } finally {
      setBusy(false)
    }
  }

  if (!projectId) {
    return (
      <div className="min-h-screen bg-white dark:bg-gray-950 p-6">
        <div className="max-w-6xl mx-auto text-sm text-gray-400 dark:text-gray-500 py-12 text-center">
          No corpus project selected.{' '}
          <Link href="/admin/a2h" className="underline hover:text-gray-700 dark:hover:text-gray-300">Pick one from the A2H home</Link>.
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950 p-6">
      <div className="max-w-6xl mx-auto space-y-5">
        <div>
          <Link href={`/admin/a2h/corpus?project=${projectId}`} className="text-xs text-gray-400 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-300">← {project?.name ?? 'A2H Benchmark'}</Link>
          <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mt-1">Benchmark Runs</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">GPTZero baseline, intensity transformation, and post-transform scoring against frozen sources.</p>
        </div>

        {project && project.status !== 'frozen' && (
          <div className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-xl px-4 py-2.5">
            This project is not frozen yet — benchmark execution runs against frozen sources only.{' '}
            <Link href={`/admin/a2h/corpus?project=${projectId}`} className="underline">Go to Source Matrix</Link>.
          </div>
        )}

        {project && (
          <div className="flex flex-wrap gap-1.5">
            {project.domains.map(d => (
              <button
                key={d}
                onClick={() => setDomain(d)}
                className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors capitalize ${
                  d === domain
                    ? 'border-gray-900 bg-gray-900 text-white dark:border-gray-100 dark:bg-gray-100 dark:text-gray-900'
                    : 'border-gray-200 text-gray-600 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800'
                }`}
              >
                {d}
              </button>
            ))}
          </div>
        )}

        {error && (
          <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-xl px-4 py-2.5">{error}</div>
        )}

        {loading ? (
          <div className="flex justify-center py-12">
            <Spinner className="w-6 h-6 border-gray-200 border-t-gray-700 dark:border-gray-700 dark:border-t-gray-300" />
          </div>
        ) : (
          <div className="overflow-x-auto border border-gray-200 dark:border-gray-800 rounded-2xl">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-800">
                  <th className="text-left px-3 py-2 text-gray-400 dark:text-gray-500 font-medium sticky left-0 bg-white dark:bg-gray-950">Topic</th>
                  {(project?.lengthLadder ?? []).map(len => (
                    <th key={len} className="px-2 py-2 text-gray-400 dark:text-gray-500 font-medium text-center">{len}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {topics.map(topic => (
                  <tr key={topic.id} className="border-b border-gray-100 dark:border-gray-900 last:border-b-0">
                    <td className="px-3 py-1.5 text-gray-700 dark:text-gray-300 whitespace-nowrap sticky left-0 bg-white dark:bg-gray-950">
                      <span className="text-gray-400 dark:text-gray-600 mr-1.5">#{topic.topicNumber}</span>{topic.title}
                    </td>
                    {(project?.lengthLadder ?? []).map(len => {
                      const source = sources[cellKey(topic.id, len)]
                      const isSelected = selected?.topic.id === topic.id && selected.targetWords === len
                      return (
                        <td key={len} className="px-1 py-1 text-center">
                          <button
                            onClick={() => source && setSelected({ topic, targetWords: len })}
                            disabled={!source}
                            className={`w-8 h-8 rounded-lg text-[10px] font-semibold transition-all ${
                              source ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' : 'bg-gray-100 text-gray-300 dark:bg-gray-800 dark:text-gray-700'
                            } ${isSelected ? 'ring-2 ring-gray-900 dark:ring-gray-100' : ''}`}
                            title={source ? `frozen · ${source.actualWords} words` : 'Not frozen yet'}
                          >
                            {source ? source.actualWords : '—'}
                          </button>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {selected && selectedSource && (
          <div className="border border-gray-200 dark:border-gray-800 rounded-2xl p-4 space-y-3">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {selected.topic.title} · {selected.targetWords} words
            </h2>

            <div className="border-t border-gray-200 dark:border-gray-800 pt-3 flex items-center justify-between">
              <div>
                <h3 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">GPTZero Baseline</h3>
                {selectedBaseline ? (
                  <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                    {selectedBaseline.classification} · AI {formatPct(selectedBaseline.aiProbability)} · Human {formatPct(selectedBaseline.humanProbability)}
                    {selectedBaseline.mixedProbability != null && ` · Mixed ${formatPct(selectedBaseline.mixedProbability)}`}
                  </p>
                ) : (
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Not yet acquired</p>
                )}
              </div>
              <button onClick={() => handleAcquireBaseline(Boolean(selectedBaseline))} disabled={busy}
                className="text-xs font-medium px-3.5 py-2 rounded-xl border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 disabled:opacity-40 shrink-0">
                {busy ? 'Working…' : selectedBaseline ? 'Re-acquire' : 'Acquire baseline'}
              </button>
            </div>

            <div className="border-t border-gray-200 dark:border-gray-800 pt-3 space-y-3">
              <h3 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Intensity Transformations</h3>
              {outputsLoading ? (
                <Spinner className="w-4 h-4 border-gray-200 border-t-gray-700 dark:border-gray-700 dark:border-t-gray-300" />
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {INTENSITIES.map(i => {
                    const output = outputs[i]
                    const state = output?.status ?? 'empty'
                    return (
                      <button
                        key={i}
                        onClick={() => setSelectedIntensity(i)}
                        className={`w-9 h-9 rounded-lg text-[10px] font-semibold transition-all ${OUTPUT_CELL_STYLES[state]} ${
                          selectedIntensity === i ? 'ring-2 ring-gray-900 dark:ring-gray-100' : ''
                        }`}
                        title={output ? `${output.status} · ${output.outputWords} words` : 'Not transformed'}
                      >
                        I{i}
                      </button>
                    )
                  })}
                </div>
              )}

              {selectedIntensity != null && (
                <div className="space-y-2 pl-0.5">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {selectedOutput
                        ? `${selectedOutput.status} · ${selectedOutput.outputWords} words · ${selectedOutput.latencyMs}ms · ${selectedOutput.retryCount} retries`
                        : `Intensity ${selectedIntensity} not yet transformed`}
                    </p>
                    <div className="flex items-center gap-2">
                      {!selectedOutput && (
                        <button onClick={() => handleTransform(false)} disabled={busy}
                          className="text-xs font-medium px-3.5 py-2 rounded-xl bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900 disabled:opacity-40">
                          {busy ? 'Transforming…' : 'Transform'}
                        </button>
                      )}
                      {selectedOutput && (
                        <button onClick={() => handleTransform(true)} disabled={busy}
                          className="text-xs font-medium px-3.5 py-2 rounded-xl border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 disabled:opacity-40">
                          {busy ? 'Working…' : 'Regenerate'}
                        </button>
                      )}
                    </div>
                  </div>

                  {selectedOutput?.status === 'success' && (
                    <div className="max-h-48 overflow-y-auto text-sm text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-900/50 rounded-xl p-3 whitespace-pre-wrap">
                      {selectedOutput.outputText}
                    </div>
                  )}
                  {selectedOutput?.status === 'failed' && (
                    <p className="text-xs text-red-600 dark:text-red-400">{selectedOutput.errorMessage}</p>
                  )}

                  {selectedOutput?.status === 'success' && (
                    <div className="flex items-center justify-between border-t border-gray-100 dark:border-gray-900 pt-2">
                      <div>
                        <p className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Post-transform GPTZero</p>
                        {selectedPostScore ? (
                          <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                            {selectedPostScore.classification} · AI {formatPct(selectedPostScore.aiProbability)} · Human {formatPct(selectedPostScore.humanProbability)}
                          </p>
                        ) : (
                          <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Not yet acquired</p>
                        )}
                      </div>
                      <button onClick={() => handleAcquirePostScore(Boolean(selectedPostScore))} disabled={busy}
                        className="text-xs font-medium px-3.5 py-2 rounded-xl border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 disabled:opacity-40 shrink-0">
                        {busy ? 'Working…' : selectedPostScore ? 'Re-acquire' : 'Acquire score'}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

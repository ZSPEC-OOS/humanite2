'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { DOMAINS, type Domain } from '@/lib/style/types'
import { LENGTH_LADDER, DEFAULT_CORPUS_VERSION } from '@/lib/a2h/types'
import {
  apiListTopics, apiListCorpus, apiGenerateSource, apiFreezeSource,
  apiListBaselines, apiAcquireBaseline,
  type BenchmarkTopic, type CorpusSource, type DetectorResult,
} from '@/lib/a2hApi'
import { Spinner } from '@/components/ui/Spinner'

type CellKey = string
function cellKey(topicId: string, targetWords: number): CellKey {
  return `${topicId}__${targetWords}`
}

const CELL_STYLES: Record<string, string> = {
  empty: 'bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-600',
  validated: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  validation_failed: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  frozen: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
}

export default function A2HCorpusPage() {
  const [domain, setDomain] = useState<Domain>('general')
  const [topics, setTopics] = useState<BenchmarkTopic[]>([])
  const [sources, setSources] = useState<Record<CellKey, CorpusSource>>({})
  const [baselines, setBaselines] = useState<Record<string, DetectorResult>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<{ topic: BenchmarkTopic; targetWords: number } | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setSelected(null)
    Promise.all([apiListTopics(domain), apiListCorpus(domain, DEFAULT_CORPUS_VERSION), apiListBaselines(domain, DEFAULT_CORPUS_VERSION)])
      .then(([topicsData, sourcesData, baselinesData]) => {
        if (cancelled) return
        setTopics(topicsData)
        const map: Record<CellKey, CorpusSource> = {}
        for (const s of sourcesData) map[cellKey(s.topicId, s.targetWords)] = s
        setSources(map)
        setBaselines(baselinesData)
      })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load corpus data.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [domain])

  const selectedSource = selected ? sources[cellKey(selected.topic.id, selected.targetWords)] : undefined
  const selectedBaseline = selectedSource ? baselines[selectedSource.id] : undefined

  async function handleGenerate(force: boolean) {
    if (!selected) return
    setBusy(true)
    setError(null)
    try {
      const source = await apiGenerateSource(selected.topic.id, selected.targetWords, force)
      setSources(prev => ({ ...prev, [cellKey(source.topicId, source.targetWords)]: source }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed.')
    } finally {
      setBusy(false)
    }
  }

  async function handleFreeze() {
    if (!selected) return
    setBusy(true)
    setError(null)
    try {
      const source = await apiFreezeSource(selected.topic.id, selected.targetWords)
      setSources(prev => ({ ...prev, [cellKey(source.topicId, source.targetWords)]: source }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Freeze failed.')
    } finally {
      setBusy(false)
    }
  }

  async function handleAcquireBaseline(force: boolean) {
    if (!selected) return
    setBusy(true)
    setError(null)
    try {
      const baseline = await apiAcquireBaseline(selected.topic.id, selected.targetWords, force)
      setBaselines(prev => ({ ...prev, [baseline.sourceId]: baseline }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Baseline acquisition failed.')
    } finally {
      setBusy(false)
    }
  }

  const counts = useMemo(() => {
    const values = Object.values(sources)
    return {
      frozen: values.filter(s => s.status === 'frozen').length,
      validated: values.filter(s => s.status === 'validated').length,
      failed: values.filter(s => s.status === 'validation_failed').length,
      total: topics.length * LENGTH_LADDER.length,
    }
  }, [sources, topics])

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950 p-6">
      <div className="max-w-6xl mx-auto space-y-5">
        <div>
          <Link href="/admin/a2h" className="text-xs text-gray-400 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-300">← A2H Benchmark</Link>
          <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mt-1">Corpus Matrix</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {DEFAULT_CORPUS_VERSION} · {counts.frozen} frozen · {counts.validated} awaiting freeze · {counts.failed} validation issues · {counts.total} cells for {domain}
          </p>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {DOMAINS.map(d => (
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

        {error && (
          <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-xl px-4 py-2.5">{error}</div>
        )}

        {loading ? (
          <div className="flex justify-center py-12">
            <Spinner className="w-6 h-6 border-gray-200 border-t-gray-700 dark:border-gray-700 dark:border-t-gray-300" />
          </div>
        ) : topics.length === 0 ? (
          <div className="text-sm text-gray-400 dark:text-gray-500 py-8 text-center">
            No topics defined for {domain} yet.{' '}
            <Link href="/admin/a2h/topics" className="underline hover:text-gray-700 dark:hover:text-gray-300">Add topic outlines</Link>.
          </div>
        ) : (
          <div className="overflow-x-auto border border-gray-200 dark:border-gray-800 rounded-2xl">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-800">
                  <th className="text-left px-3 py-2 text-gray-400 dark:text-gray-500 font-medium sticky left-0 bg-white dark:bg-gray-950">Topic</th>
                  {LENGTH_LADDER.map(len => (
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
                    {LENGTH_LADDER.map(len => {
                      const source = sources[cellKey(topic.id, len)]
                      const state = source?.status ?? 'empty'
                      const isSelected = selected?.topic.id === topic.id && selected.targetWords === len
                      return (
                        <td key={len} className="px-1 py-1 text-center">
                          <button
                            onClick={() => setSelected({ topic, targetWords: len })}
                            className={`w-8 h-8 rounded-lg text-[10px] font-semibold transition-all ${CELL_STYLES[state]} ${
                              isSelected ? 'ring-2 ring-gray-900 dark:ring-gray-100' : ''
                            }`}
                            title={source ? `${source.status} · ${source.actualWords} words` : 'Not generated'}
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

        {selected && (
          <div className="border border-gray-200 dark:border-gray-800 rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {selected.topic.title} · {selected.targetWords} words
                </h2>
                {selectedSource && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {selectedSource.status} · {selectedSource.actualWords} actual words · sha256 {selectedSource.sha256.slice(0, 12)}…
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                {!selectedSource && (
                  <button onClick={() => handleGenerate(false)} disabled={busy}
                    className="text-xs font-medium px-3.5 py-2 rounded-xl bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900 disabled:opacity-40">
                    {busy ? 'Generating…' : 'Generate'}
                  </button>
                )}
                {selectedSource && selectedSource.status !== 'frozen' && (
                  <button onClick={() => handleGenerate(true)} disabled={busy}
                    className="text-xs font-medium px-3.5 py-2 rounded-xl border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 disabled:opacity-40">
                    {busy ? 'Regenerating…' : 'Regenerate'}
                  </button>
                )}
                {selectedSource?.status === 'validated' && (
                  <button onClick={handleFreeze} disabled={busy}
                    className="text-xs font-medium px-3.5 py-2 rounded-xl bg-green-600 text-white disabled:opacity-40">
                    {busy ? 'Freezing…' : 'Freeze'}
                  </button>
                )}
              </div>
            </div>
            {selectedSource && (
              <div className="max-h-64 overflow-y-auto text-sm text-gray-700 dark:text-gray-300 bg-gray-50 dark:bg-gray-900/50 rounded-xl p-3 whitespace-pre-wrap">
                {selectedSource.text}
              </div>
            )}

            {selectedSource?.status === 'frozen' && (
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
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function formatPct(value: number | null): string {
  return value == null ? '—' : `${Math.round(value * 100)}%`
}

'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import type { Domain } from '@/lib/style/types'
import {
  apiGetProject, apiListTopics, apiListCorpus, apiGenerateSource, apiFreezeSource,
  apiFreezeCheck, apiFreezeProject,
  type BenchmarkTopic, type CorpusSource, type CorpusProject, type FreezeValidationResult,
} from '@/lib/a2hApi'
import { Spinner } from '@/components/ui/Spinner'
import { CorpusSteps } from '@/components/a2h/CorpusSteps'

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

// Corpus Matrix's job ends at the frozen source document: generate,
// inspect, validate word count, regenerate a non-frozen cell, freeze a
// cell, and show matrix completeness. Everything past that point —
// intensity transformations, GPTZero baseline/post-transform calls — is
// benchmark execution, not corpus preparation, and lives on its own
// Benchmark Runs page instead.
export default function A2HCorpusPage() {
  const searchParams = useSearchParams()
  const projectId = searchParams.get('project') ?? ''

  const [project, setProject] = useState<CorpusProject | null>(null)
  const [domain, setDomain] = useState<Domain | null>(null)
  const [topics, setTopics] = useState<BenchmarkTopic[]>([])
  const [sources, setSources] = useState<Record<CellKey, CorpusSource>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<{ topic: BenchmarkTopic; targetWords: number } | null>(null)
  const [busy, setBusy] = useState(false)

  const [bulkScope, setBulkScope] = useState<'all' | 'current'>('current')
  const [bulkRunning, setBulkRunning] = useState(false)
  const [bulkStatus, setBulkStatus] = useState<{ done: number; total: number } | null>(null)

  const [validation, setValidation] = useState<FreezeValidationResult | null>(null)
  const [validationLoading, setValidationLoading] = useState(false)
  const [showProblems, setShowProblems] = useState(false)
  const [freezing, setFreezing] = useState(false)

  useEffect(() => {
    if (!projectId) {
      setError('No corpus project selected.')
      setLoading(false)
      return
    }
    let cancelled = false
    apiGetProject(projectId)
      .then(p => {
        if (cancelled) return
        setProject(p)
        setDomain(prev => prev ?? p.domains[0] ?? null)
      })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load corpus project.') })
    return () => { cancelled = true }
  }, [projectId])

  useEffect(() => {
    if (!projectId || !domain) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setSelected(null)
    Promise.all([apiListTopics(projectId, domain), apiListCorpus(projectId, domain)])
      .then(([topicsData, sourcesData]) => {
        if (cancelled) return
        setTopics(topicsData)
        const map: Record<CellKey, CorpusSource> = {}
        for (const s of sourcesData) map[cellKey(s.topicId, s.targetWords)] = s
        setSources(map)
      })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load corpus data.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [projectId, domain])

  function refreshValidation() {
    if (!projectId) return
    setValidationLoading(true)
    apiFreezeCheck(projectId).then(setValidation).catch(() => {}).finally(() => setValidationLoading(false))
  }
  useEffect(refreshValidation, [projectId, project?.status])

  const selectedSource = selected ? sources[cellKey(selected.topic.id, selected.targetWords)] : undefined

  async function handleGenerate(force: boolean) {
    if (!selected) return
    setBusy(true)
    setError(null)
    try {
      const source = await apiGenerateSource(projectId, selected.topic.id, selected.targetWords, force)
      setSources(prev => ({ ...prev, [cellKey(source.topicId, source.targetWords)]: source }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed.')
    } finally {
      setBusy(false)
    }
  }

  async function handleFreezeSource() {
    if (!selected) return
    setBusy(true)
    setError(null)
    try {
      const source = await apiFreezeSource(projectId, selected.topic.id, selected.targetWords)
      setSources(prev => ({ ...prev, [cellKey(source.topicId, source.targetWords)]: source }))
      refreshValidation()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Freeze failed.')
    } finally {
      setBusy(false)
    }
  }

  // Targets only cells with no source yet — a validation_failed cell is a
  // deliberate per-cell regenerate decision (via the cell inspector below),
  // and a frozen cell is never touched. Because it only ever fills gaps,
  // re-running it after a partial run or a failure naturally resumes
  // exactly where it left off.
  async function handleGenerateMissing() {
    if (!project) return
    setBulkRunning(true)
    setError(null)
    try {
      const domainsToFill = bulkScope === 'all' ? project.domains : domain ? [domain] : []
      const cells: { topic: BenchmarkTopic; targetWords: number }[] = []
      for (const d of domainsToFill) {
        const domainTopics = d === domain ? topics : await apiListTopics(project.id, d)
        const domainSources = d === domain ? sources : Object.fromEntries((await apiListCorpus(project.id, d)).map(s => [cellKey(s.topicId, s.targetWords), s]))
        for (const topic of domainTopics) {
          for (const len of project.lengthLadder) {
            if (!domainSources[cellKey(topic.id, len)]) cells.push({ topic, targetWords: len })
          }
        }
      }
      setBulkStatus({ done: 0, total: cells.length })
      for (let i = 0; i < cells.length; i++) {
        const cell = cells[i]!
        try {
          const source = await apiGenerateSource(project.id, cell.topic.id, cell.targetWords, false)
          if (cell.topic.domainId === domain) {
            setSources(prev => ({ ...prev, [cellKey(source.topicId, source.targetWords)]: source }))
          }
        } catch {
          // Continue past a single cell's failure — a transient model error
          // on one cell shouldn't abort the whole run; the cell simply stays
          // missing and can be retried by running this again or generating
          // it individually.
        }
        setBulkStatus({ done: i + 1, total: cells.length })
      }
      refreshValidation()
    } finally {
      setBulkRunning(false)
    }
  }

  async function handleFreezeCorpus() {
    if (!project) return
    if (!window.confirm(`Freeze "${project.name}"? The entire source matrix becomes permanently immutable.`)) return
    setFreezing(true)
    setError(null)
    try {
      const updated = await apiFreezeProject(project.id)
      setProject(updated)
      refreshValidation()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Freeze failed.')
    } finally {
      setFreezing(false)
    }
  }

  const ladder = project?.lengthLadder ?? []
  const canGenerate = project != null && ['blueprint_locked', 'generating'].includes(project.status)

  const counts = useMemo(() => {
    const values = Object.values(sources)
    return {
      frozen: values.filter(s => s.status === 'frozen').length,
      validated: values.filter(s => s.status === 'validated').length,
      failed: values.filter(s => s.status === 'validation_failed').length,
      total: topics.length * ladder.length,
    }
  }, [sources, topics, ladder.length])

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
        <div className="space-y-3">
          <div>
            <Link href={`/admin/a2h/corpus-design?project=${projectId}`} className="text-xs text-gray-400 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-300">← {project?.name ?? 'A2H Benchmark'}</Link>
            <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mt-1">Source Matrix</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {counts.frozen} frozen · {counts.validated} awaiting freeze · {counts.failed} validation issues · {counts.total} cells for {domain}
            </p>
          </div>
          {project && <CorpusSteps status={project.status} current={project.status === 'frozen' ? 'freeze' : 'matrix'} />}
          {project?.status === 'frozen' && (
            <Link href={`/admin/a2h/benchmark?project=${projectId}`} className="inline-block text-xs font-medium px-3.5 py-2 rounded-xl border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300">
              Go to Benchmark Runs →
            </Link>
          )}
        </div>

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

        {canGenerate && (
          <div className="border border-gray-200 dark:border-gray-800 rounded-2xl p-4 flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2 text-xs">
              <span className="text-gray-500 dark:text-gray-400">Generate Missing Sources for</span>
              <select value={bulkScope} onChange={e => setBulkScope(e.target.value as 'all' | 'current')}
                className="rounded-lg px-2 py-1 bg-white border border-gray-300 text-gray-700 dark:bg-gray-900 dark:border-gray-700 dark:text-gray-300">
                <option value="current">Current domain</option>
                <option value="all">All domains</option>
              </select>
              {bulkStatus && <span className="text-gray-400 dark:text-gray-500">{bulkStatus.done} / {bulkStatus.total}</span>}
            </div>
            <button onClick={handleGenerateMissing} disabled={bulkRunning}
              className="text-xs font-medium px-3.5 py-2 rounded-xl bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900 disabled:opacity-40">
              {bulkRunning ? 'Generating…' : 'Generate Missing Sources'}
            </button>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-12">
            <Spinner className="w-6 h-6 border-gray-200 border-t-gray-700 dark:border-gray-700 dark:border-t-gray-300" />
          </div>
        ) : !canGenerate && project?.status !== 'frozen' ? (
          <div className="text-sm text-gray-400 dark:text-gray-500 py-8 text-center">
            Lock the blueprint before generating corpus sources.{' '}
            <Link href={`/admin/a2h/corpus-design?project=${projectId}`} className="underline hover:text-gray-700 dark:hover:text-gray-300">Configure Corpus Design</Link>.
          </div>
        ) : ladder.length === 0 ? (
          <div className="text-sm text-gray-400 dark:text-gray-500 py-8 text-center">
            This project has no length ladder configured.
          </div>
        ) : topics.length === 0 ? (
          <div className="text-sm text-gray-400 dark:text-gray-500 py-8 text-center">
            No topics defined for {domain} yet.{' '}
            <Link href={`/admin/a2h/topics?project=${projectId}`} className="underline hover:text-gray-700 dark:hover:text-gray-300">Add topic outlines</Link>.
          </div>
        ) : (
          <div className="overflow-x-auto border border-gray-200 dark:border-gray-800 rounded-2xl">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-800">
                  <th className="text-left px-3 py-2 text-gray-400 dark:text-gray-500 font-medium sticky left-0 bg-white dark:bg-gray-950">Topic</th>
                  {ladder.map(len => (
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
                    {ladder.map(len => {
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
                {!selectedSource && canGenerate && (
                  <button onClick={() => handleGenerate(false)} disabled={busy}
                    className="text-xs font-medium px-3.5 py-2 rounded-xl bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900 disabled:opacity-40">
                    {busy ? 'Generating…' : 'Generate'}
                  </button>
                )}
                {selectedSource && selectedSource.status !== 'frozen' && canGenerate && (
                  <button onClick={() => handleGenerate(true)} disabled={busy}
                    className="text-xs font-medium px-3.5 py-2 rounded-xl border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 disabled:opacity-40">
                    {busy ? 'Regenerating…' : 'Regenerate'}
                  </button>
                )}
                {selectedSource?.status === 'validated' && (
                  <button onClick={handleFreezeSource} disabled={busy}
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
          </div>
        )}

        {/* Whole-corpus freeze — the last step, and the strictest: every
            expected topic/length cell must exist and be frozen already,
            with nothing validated-only or validation_failed left behind. */}
        <div className="border border-gray-200 dark:border-gray-800 rounded-2xl p-4 space-y-3">
          <h2 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Freeze Corpus</h2>
          {validationLoading || !validation ? (
            <Spinner className="w-4 h-4 border-gray-200 border-t-gray-700 dark:border-gray-700 dark:border-t-gray-300" />
          ) : project?.status === 'frozen' ? (
            <p className="text-sm text-green-700 dark:text-green-400">This corpus is frozen and immutable — {validation.actualSourceCount} source documents.</p>
          ) : validation.ok ? (
            <div className="flex items-center justify-between flex-wrap gap-3">
              <p className="text-sm text-gray-600 dark:text-gray-400">Every expected cell is generated and frozen — {validation.expectedSourceCount} sources.</p>
              <button onClick={handleFreezeCorpus} disabled={freezing}
                className="text-xs font-medium px-3.5 py-2 rounded-xl bg-green-600 text-white disabled:opacity-40">
                {freezing ? 'Freezing…' : 'Freeze Corpus'}
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-amber-700 dark:text-amber-400">Cannot freeze corpus yet.</p>
              <dl className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
                <Stat label="Expected" value={validation.expectedSourceCount} />
                <Stat label="Present" value={validation.actualSourceCount} />
                <Stat label="Frozen" value={validation.frozenCount} />
                <Stat label="Missing" value={validation.missingCells.length} warn />
                <Stat label="Not frozen" value={validation.validatedNotFrozenCount + validation.validationFailedCount} warn />
              </dl>
              {(validation.missingCells.length > 0 || validation.problems.length > 0) && (
                <button onClick={() => setShowProblems(v => !v)} className="text-xs text-gray-500 hover:text-gray-800 dark:hover:text-gray-300 underline">
                  {showProblems ? 'Hide problems' : 'View Problems'}
                </button>
              )}
              {showProblems && (
                <div className="max-h-48 overflow-y-auto text-xs text-gray-600 dark:text-gray-400 space-y-1 bg-gray-50 dark:bg-gray-900/50 rounded-xl p-3">
                  {validation.problems.map((p, i) => <p key={`p-${i}`}>{p}</p>)}
                  {validation.missingCells.map((c, i) => (
                    <p key={`m-${i}`}>Missing: {c.domainId} / {c.topicTitle} / {c.targetWords} words</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, warn = false }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="bg-gray-50 dark:bg-gray-900/50 rounded-xl px-3 py-2">
      <dt className="text-gray-400 dark:text-gray-500">{label}</dt>
      <dd className={`text-sm font-semibold tabular-nums ${warn && value > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-800 dark:text-gray-200'}`}>{value}</dd>
    </div>
  )
}

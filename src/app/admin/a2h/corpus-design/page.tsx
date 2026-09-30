'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { DOMAINS, type Domain } from '@/lib/style/types'
import { DEFAULT_LENGTH_LADDER, TOPICS_PER_DOMAIN, MAX_TOPICS_PER_DOMAIN } from '@/lib/a2h/types'
import {
  apiGetProject, apiUpdateProjectDraft, apiLockBlueprint, apiFreezeProject,
  apiListTopics,
  type CorpusProject,
} from '@/lib/a2hApi'
import { Spinner } from '@/components/ui/Spinner'

const INTENSITY_COUNT = 10

function parseLadderDraft(draft: string[]): { values: number[] } | { error: string } {
  if (draft.length === 0) return { error: 'Add at least one length.' }
  const values: number[] = []
  for (const raw of draft) {
    const trimmed = raw.trim()
    const n = Number(trimmed)
    if (!trimmed || !Number.isInteger(n) || n <= 0) {
      return { error: 'Every length must be a positive whole number.' }
    }
    values.push(n)
  }
  if (new Set(values).size !== values.length) {
    return { error: 'Duplicate lengths are not allowed.' }
  }
  return { values: [...values].sort((a, b) => a - b) }
}

export default function A2HCorpusDesignPage() {
  const projectId = useSearchParams().get('project')

  const [project, setProject] = useState<CorpusProject | null>(null)
  const [topicsByDomain, setTopicsByDomain] = useState<Partial<Record<Domain, number>>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [draftDomains, setDraftDomains] = useState<Domain[]>([...DOMAINS])
  const [draftCounts, setDraftCounts] = useState<Partial<Record<Domain, string>>>({})
  const [draftLadder, setDraftLadder] = useState<string[]>(DEFAULT_LENGTH_LADDER.map(String))
  const [newLength, setNewLength] = useState('')

  useEffect(() => {
    if (!projectId) { setLoading(false); return }
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all([apiGetProject(projectId), apiListTopics(projectId)])
      .then(([p, topics]) => {
        if (cancelled) return
        setProject(p)
        setDraftDomains(p.domains)
        const counts: Partial<Record<Domain, string>> = {}
        for (const d of p.domains) counts[d] = String(p.topicCountByDomain[d] ?? '')
        setDraftCounts(counts)
        setDraftLadder(p.lengthLadder.length > 0 ? p.lengthLadder.map(String) : DEFAULT_LENGTH_LADDER.map(String))
        const byDomain: Partial<Record<Domain, number>> = {}
        for (const t of topics) byDomain[t.domainId] = (byDomain[t.domainId] ?? 0) + 1
        setTopicsByDomain(byDomain)
      })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load corpus project.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [projectId])

  const isDraft = project?.status === 'draft'

  function toggleDomain(d: Domain) {
    setDraftDomains(prev => (prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d]))
  }

  function applyPreset() {
    setDraftLadder(DEFAULT_LENGTH_LADDER.map(String))
  }
  function addDraftLength() {
    const trimmed = newLength.trim()
    if (!trimmed) return
    setDraftLadder(prev => [...prev, trimmed])
    setNewLength('')
  }
  function updateDraftLength(index: number, value: string) {
    setDraftLadder(prev => prev.map((v, i) => (i === index ? value : v)))
  }
  function removeDraftLength(index: number) {
    setDraftLadder(prev => prev.filter((_, i) => i !== index))
  }

  const parsedLadder = parseLadderDraft(draftLadder)

  async function handleSaveDraft() {
    if (!project) return
    if ('error' in parsedLadder) { setError(parsedLadder.error); return }
    if (draftDomains.length === 0) { setError('Select at least one domain.'); return }
    const topicCountByDomain: Record<string, number> = {}
    for (const d of draftDomains) {
      const n = Number(draftCounts[d])
      if (!Number.isInteger(n) || n < 1) { setError(`Set a valid topic count for ${d}.`); return }
      topicCountByDomain[d] = n
    }
    setBusy(true)
    setError(null)
    try {
      const updated = await apiUpdateProjectDraft(project.id, {
        domains: draftDomains,
        topicCountByDomain,
        lengthLadder: parsedLadder.values,
      })
      setProject(updated)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.')
    } finally {
      setBusy(false)
    }
  }

  async function handleLockBlueprint() {
    if (!project) return
    if (!window.confirm('Lock the blueprint? Domains, topic counts, and the length ladder become permanent, and the topic roster can no longer change.')) return
    setBusy(true)
    setError(null)
    try {
      setProject(await apiLockBlueprint(project.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lock failed.')
    } finally {
      setBusy(false)
    }
  }

  async function handleFreeze() {
    if (!project) return
    if (!window.confirm(`Freeze "${project.name}"? This marks the corpus build complete.`)) return
    setBusy(true)
    setError(null)
    try {
      setProject(await apiFreezeProject(project.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Freeze failed.')
    } finally {
      setBusy(false)
    }
  }

  const totalTopics = draftDomains.reduce((sum, d) => sum + (Number(draftCounts[d]) || 0), 0)
  const ladderLength = 'values' in parsedLadder ? parsedLadder.values.length : draftLadder.length
  const totalSources = totalTopics * ladderLength
  const totalOutputs = totalSources * INTENSITY_COUNT
  const totalGptZero = totalSources + totalOutputs

  if (!projectId) {
    return (
      <div className="min-h-screen bg-white dark:bg-gray-950 flex items-center justify-center p-6">
        <div className="text-center space-y-2">
          <p className="text-sm text-gray-500 dark:text-gray-400">No corpus project selected.</p>
          <Link href="/admin/a2h" className="text-sm underline text-gray-500 hover:text-gray-800 dark:hover:text-gray-300">Choose a corpus project</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950 p-6">
      <div className="max-w-3xl mx-auto space-y-5">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <Link href="/admin/a2h" className="text-xs text-gray-400 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-300">← A2H Benchmark</Link>
            <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mt-1">{project?.name ?? 'Corpus Design'}</h1>
            {project && (
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {project.status} · {project.corpusVersion}
              </p>
            )}
          </div>
          {project && (
            <div className="flex items-center gap-2">
              <Link href={`/admin/a2h/topics?project=${project.id}`}
                className="text-xs font-medium px-3.5 py-2 rounded-xl border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300">
                Manage Topic Blueprint
              </Link>
              <Link href={`/admin/a2h/corpus?project=${project.id}`}
                className="text-xs font-medium px-3.5 py-2 rounded-xl border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300">
                Corpus Matrix
              </Link>
            </div>
          )}
        </div>

        {error && (
          <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-xl px-4 py-2.5">{error}</div>
        )}

        {loading ? (
          <div className="flex justify-center py-12">
            <Spinner className="w-6 h-6 border-gray-200 border-t-gray-700 dark:border-gray-700 dark:border-t-gray-300" />
          </div>
        ) : !project ? (
          <p className="text-sm text-gray-400 dark:text-gray-500">Corpus project not found.</p>
        ) : (
          <>
            {/* Domains */}
            <div className="border border-gray-200 dark:border-gray-800 rounded-2xl p-4 space-y-3">
              <h2 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Domains</h2>
              <div className="flex flex-wrap gap-1.5">
                {DOMAINS.map(d => {
                  const active = isDraft ? draftDomains.includes(d) : project.domains.includes(d)
                  return (
                    <button
                      key={d}
                      onClick={() => isDraft && toggleDomain(d)}
                      disabled={!isDraft}
                      className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors capitalize disabled:cursor-default ${
                        active
                          ? 'border-gray-900 bg-gray-900 text-white dark:border-gray-100 dark:bg-gray-100 dark:text-gray-900'
                          : 'border-gray-200 text-gray-400 dark:border-gray-700 dark:text-gray-600'
                      }`}
                    >
                      {d}
                    </button>
                  )
                })}
              </div>

              {/* Topic counts per domain */}
              <div className="space-y-1.5 pt-1">
                {(isDraft ? draftDomains : project.domains).map(d => (
                  <div key={d} className="flex items-center justify-between">
                    <span className="text-sm text-gray-600 dark:text-gray-400 capitalize">{d}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400 dark:text-gray-500">
                        {topicsByDomain[d] ?? 0} generated
                      </span>
                      {isDraft ? (
                        <input
                          type="number" min={1} max={MAX_TOPICS_PER_DOMAIN}
                          value={draftCounts[d] ?? ''}
                          onChange={e => setDraftCounts(prev => ({ ...prev, [d]: e.target.value }))}
                          placeholder={String(TOPICS_PER_DOMAIN)}
                          className="w-16 text-sm rounded-xl px-2.5 py-1 bg-white border border-gray-300 text-gray-700 dark:bg-gray-900 dark:border-gray-700 dark:text-gray-300 focus:outline-none focus:border-gray-900 dark:focus:border-gray-100"
                        />
                      ) : (
                        <span className="text-sm text-gray-700 dark:text-gray-300 w-16 text-right">{project.topicCountByDomain[d] ?? '—'}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Length ladder */}
            <div className="border border-gray-200 dark:border-gray-800 rounded-2xl p-4 space-y-3">
              <h2 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Length Ladder</h2>

              {isDraft ? (
                <div className="flex flex-wrap gap-1.5">
                  {draftLadder.map((val, i) => (
                    <span key={i} className="inline-flex items-center gap-1 rounded-lg bg-gray-100 dark:bg-gray-800 pl-2 pr-1 py-0.5">
                      <input
                        type="text" inputMode="numeric" value={val}
                        onChange={e => updateDraftLength(i, e.target.value)}
                        className="w-14 text-xs font-medium bg-transparent text-gray-700 dark:text-gray-300 py-1 focus:outline-none"
                      />
                      <button onClick={() => removeDraftLength(i)}
                        className="w-5 h-5 flex items-center justify-center rounded text-gray-400 hover:text-gray-800 hover:bg-gray-200 dark:hover:text-gray-100 dark:hover:bg-gray-700">
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {project.lengthLadder.map(len => (
                    <span key={len} className="inline-flex items-center text-xs font-medium px-2.5 py-1.5 rounded-lg bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                      {len}
                    </span>
                  ))}
                </div>
              )}

              {isDraft && 'error' in parsedLadder && (
                <p className="text-xs text-amber-600 dark:text-amber-400">{parsedLadder.error}</p>
              )}

              {isDraft && (
                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="number" min={1} placeholder="e.g. 400" value={newLength}
                    onChange={e => setNewLength(e.target.value)}
                    className="w-24 text-sm rounded-xl px-3 py-1.5 bg-white border border-gray-300 text-gray-700 dark:bg-gray-900 dark:border-gray-700 dark:text-gray-300 focus:outline-none focus:border-gray-900 dark:focus:border-gray-100"
                  />
                  <button onClick={addDraftLength}
                    className="text-xs font-medium px-3 py-1.5 rounded-xl border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300">
                    + Add Length
                  </button>
                  <button onClick={applyPreset}
                    className="text-xs font-medium px-3 py-1.5 rounded-xl border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300">
                    Restore Defaults
                  </button>
                </div>
              )}
            </div>

            {/* Live calculation */}
            <div className="border border-gray-200 dark:border-gray-800 rounded-2xl p-4">
              <h2 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-3">Experiment Size</h2>
              <dl className="space-y-1.5 text-sm">
                <Row label="Domains" value={(isDraft ? draftDomains : project.domains).length} />
                <Row label="Unique topics (total)" value={totalTopics} />
                <Row label="Lengths" value={ladderLength} />
                <Row label="Source documents" value={totalSources} emphasized />
                <Row label="Intensity levels" value={INTENSITY_COUNT} />
                <Row label="Humanite outputs" value={totalOutputs} emphasized />
                <Row label="GPTZero baseline calls" value={totalSources} />
                <Row label="GPTZero post-transform calls" value={totalOutputs} />
                <Row label="Total GPTZero analyses" value={totalGptZero} emphasized />
              </dl>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2">
              {isDraft && (
                <>
                  <button onClick={handleSaveDraft} disabled={busy}
                    className="text-xs font-medium px-3.5 py-2 rounded-xl border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 disabled:opacity-40">
                    {busy ? 'Saving…' : 'Save Draft'}
                  </button>
                  <button onClick={handleLockBlueprint} disabled={busy}
                    className="text-xs font-medium px-3.5 py-2 rounded-xl bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900 disabled:opacity-40">
                    {busy ? 'Working…' : 'Lock Blueprint'}
                  </button>
                </>
              )}
              {(project.status === 'blueprint_locked' || project.status === 'generating') && (
                <button onClick={handleFreeze} disabled={busy}
                  className="text-xs font-medium px-3.5 py-2 rounded-xl bg-green-600 text-white disabled:opacity-40">
                  {busy ? 'Working…' : 'Freeze Corpus'}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Row({ label, value, emphasized = false }: { label: string; value: number; emphasized?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className={emphasized ? 'font-semibold text-gray-900 dark:text-gray-100 tabular-nums' : 'text-gray-700 dark:text-gray-300 tabular-nums'}>
        {value.toLocaleString()}
      </dd>
    </div>
  )
}

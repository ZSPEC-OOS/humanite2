'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { DOMAINS, type Domain } from '@/lib/style/types'
import { DEFAULT_LENGTH_LADDER, TOPICS_PER_DOMAIN, MAX_TOPICS_PER_DOMAIN } from '@/lib/a2h/types'
import {
  apiGetProject, apiUpdateProjectDraft, apiGetManifest,
  type CorpusProject, type CorpusManifest,
} from '@/lib/a2hApi'
import { Spinner } from '@/components/ui/Spinner'
import { CorpusSteps } from '@/components/a2h/CorpusSteps'

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
  const [manifest, setManifest] = useState<CorpusManifest | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [draftDomains, setDraftDomains] = useState<Domain[]>([...DOMAINS])
  const [draftDefault, setDraftDefault] = useState(String(TOPICS_PER_DOMAIN))
  const [draftOverrides, setDraftOverrides] = useState<Partial<Record<Domain, string>>>({})
  const [customizeOpen, setCustomizeOpen] = useState(false)
  const [draftLadder, setDraftLadder] = useState<string[]>(DEFAULT_LENGTH_LADDER.map(String))
  const [newLength, setNewLength] = useState('')

  useEffect(() => {
    if (!projectId) { setLoading(false); return }
    let cancelled = false
    setLoading(true)
    setError(null)
    apiGetProject(projectId)
      .then(p => {
        if (cancelled) return
        setProject(p)
        setDraftDomains(p.domains)
        setDraftDefault(String(p.topicCountDefault))
        const overrides: Partial<Record<Domain, string>> = {}
        for (const [d, n] of Object.entries(p.topicCountOverrides)) overrides[d as Domain] = String(n)
        setDraftOverrides(overrides)
        setCustomizeOpen(Object.keys(overrides).length > 0)
        setDraftLadder(p.lengthLadder.length > 0 ? p.lengthLadder.map(String) : DEFAULT_LENGTH_LADDER.map(String))
        if (p.status === 'frozen') apiGetManifest(p.id).then(m => { if (!cancelled) setManifest(m) })
      })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load corpus project.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [projectId])

  const isDraft = project?.status === 'draft'

  function toggleDomain(d: Domain) {
    setDraftDomains(prev => (prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d]))
    setDraftOverrides(prev => {
      if (!(d in prev)) return prev
      const next = { ...prev }
      delete next[d]
      return next
    })
  }

  function resetOverride(d: Domain) {
    setDraftOverrides(prev => {
      const next = { ...prev }
      delete next[d]
      return next
    })
  }

  function applyLadderPreset() {
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
  const defaultCount = Number(draftDefault) || 0

  function effectiveCount(d: Domain): number {
    const override = draftOverrides[d]
    return override && override.trim() ? Number(override) || 0 : defaultCount
  }

  async function handleSaveDraft() {
    if (!project) return
    if ('error' in parsedLadder) { setError(parsedLadder.error); return }
    if (draftDomains.length === 0) { setError('Select at least one domain.'); return }
    if (!Number.isInteger(defaultCount) || defaultCount < 1) { setError('Set a valid default topic count.'); return }
    const overrides: Record<string, number> = {}
    for (const d of draftDomains) {
      const raw = draftOverrides[d]
      if (raw && raw.trim()) {
        const n = Number(raw)
        if (!Number.isInteger(n) || n < 1) { setError(`Set a valid override for ${d}.`); return }
        overrides[d] = n
      }
    }
    setBusy(true)
    setError(null)
    try {
      const updated = await apiUpdateProjectDraft(project.id, {
        domains: draftDomains,
        topicCountDefault: defaultCount,
        topicCountOverrides: overrides,
        lengthLadder: parsedLadder.values,
      })
      setProject(updated)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.')
    } finally {
      setBusy(false)
    }
  }

  const totalTopics = draftDomains.reduce((sum, d) => sum + effectiveCount(d), 0)
  const ladderLength = 'values' in parsedLadder ? parsedLadder.values.length : draftLadder.length
  const totalSources = totalTopics * ladderLength

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
        <div className="space-y-3">
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
                  Topic Blueprint
                </Link>
                <Link href={`/admin/a2h/corpus?project=${project.id}`}
                  className="text-xs font-medium px-3.5 py-2 rounded-xl border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300">
                  Source Matrix
                </Link>
              </div>
            )}
          </div>
          {project && <CorpusSteps status={project.status} current="setup" />}
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
            <div className="text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/50 rounded-xl px-4 py-3 leading-relaxed">
              Each topic family is generated at every configured length. Example: Medical → Hypertension → 100, 200, 300 … 2000 words.
              With {(isDraft ? draftDomains.length : project.domains.length)} domains × {isDraft ? totalTopics : Object.values(project.topicCountByDomain).reduce((a, b) => a + (b ?? 0), 0)} topic
              families × {isDraft ? ladderLength : project.lengthLadder.length} lengths, that&rsquo;s the corpus&rsquo;s expected source count below.
            </div>

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
            </div>

            {/* Topic families: default-first with per-domain overrides */}
            <div className="border border-gray-200 dark:border-gray-800 rounded-2xl p-4 space-y-3">
              <h2 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Topic Families</h2>
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-600 dark:text-gray-400">Default for all domains</span>
                {isDraft ? (
                  <input
                    type="number" min={1} max={MAX_TOPICS_PER_DOMAIN} value={draftDefault}
                    onChange={e => setDraftDefault(e.target.value)}
                    className="w-20 text-sm rounded-xl px-2.5 py-1 bg-white border border-gray-300 text-gray-700 dark:bg-gray-900 dark:border-gray-700 dark:text-gray-300 focus:outline-none focus:border-gray-900 dark:focus:border-gray-100"
                  />
                ) : (
                  <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{project.topicCountDefault}</span>
                )}
              </div>

              {isDraft && (
                <button onClick={() => setCustomizeOpen(v => !v)} className="text-xs text-gray-500 hover:text-gray-800 dark:hover:text-gray-300 underline">
                  {customizeOpen ? 'Hide per-domain overrides' : 'Customize by domain'}
                </button>
              )}

              {(customizeOpen || !isDraft) && (
                <div className="space-y-1.5 pt-1 border-t border-gray-100 dark:border-gray-900">
                  {(isDraft ? draftDomains : project.domains).map(d => {
                    const overridden = isDraft ? Boolean(draftOverrides[d]?.trim()) : project.topicCountOverrides[d] !== undefined
                    return (
                      <div key={d} className="flex items-center justify-between pt-1.5">
                        <span className="text-sm text-gray-600 dark:text-gray-400 capitalize">{d}</span>
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] uppercase tracking-wider font-medium ${overridden ? 'text-amber-600 dark:text-amber-400' : 'text-gray-400 dark:text-gray-600'}`}>
                            {overridden ? 'override' : 'inherited'}
                          </span>
                          {isDraft ? (
                            <>
                              <input
                                type="number" min={1} max={MAX_TOPICS_PER_DOMAIN}
                                value={draftOverrides[d] ?? ''}
                                placeholder={draftDefault}
                                onChange={e => setDraftOverrides(prev => ({ ...prev, [d]: e.target.value }))}
                                className="w-16 text-sm rounded-xl px-2.5 py-1 bg-white border border-gray-300 text-gray-700 dark:bg-gray-900 dark:border-gray-700 dark:text-gray-300 focus:outline-none focus:border-gray-900 dark:focus:border-gray-100"
                              />
                              {overridden && (
                                <button onClick={() => resetOverride(d)} className="text-xs text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 underline">
                                  Reset to default
                                </button>
                              )}
                            </>
                          ) : (
                            <span className="text-sm text-gray-700 dark:text-gray-300 w-10 text-right">{project.topicCountByDomain[d] ?? '—'}</span>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Length ladder */}
            <div className="border border-gray-200 dark:border-gray-800 rounded-2xl p-4 space-y-3">
              <h2 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Length Ladder</h2>
              <p className="text-xs text-gray-400 dark:text-gray-500">One shared ladder applies to every selected domain.</p>

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
                  <button onClick={applyLadderPreset}
                    className="text-xs font-medium px-3 py-1.5 rounded-xl border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300">
                    Restore Defaults
                  </button>
                </div>
              )}
            </div>

            {/* Expected corpus — corpus-design scope only, no benchmark-execution numbers */}
            <div className="border border-gray-200 dark:border-gray-800 rounded-2xl p-4">
              <h2 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-3">Expected Corpus</h2>
              <dl className="space-y-1.5 text-sm">
                <Row label="Domains" value={(isDraft ? draftDomains : project.domains).length} />
                <Row label="Topic families" value={isDraft ? totalTopics : Object.values(project.topicCountByDomain).reduce((a, b) => a + (b ?? 0), 0)} />
                <Row label="Lengths" value={isDraft ? ladderLength : project.lengthLadder.length} />
                <Row
                  label="Expected source documents"
                  value={isDraft ? totalSources : Object.values(project.topicCountByDomain).reduce((a, b) => a + (b ?? 0), 0) * project.lengthLadder.length}
                  emphasized
                />
              </dl>
            </div>

            {manifest && (
              <div className="border border-green-200 dark:border-green-900 bg-green-50 dark:bg-green-900/20 rounded-2xl p-4 space-y-1.5">
                <h2 className="text-xs font-semibold text-green-700 dark:text-green-400 uppercase tracking-wider">Frozen Corpus Manifest</h2>
                <Row label="Frozen at" value={0} display={new Date(manifest.frozenAt).toLocaleString()} />
                <Row label="Source documents" value={manifest.actualSourceCount} />
                <Row label="Manifest hash" value={0} display={`${manifest.manifestHash.slice(0, 16)}…`} />
              </div>
            )}

            {/* Actions */}
            {isDraft && (
              <div className="flex items-center gap-2">
                <button onClick={handleSaveDraft} disabled={busy}
                  className="text-xs font-medium px-3.5 py-2 rounded-xl border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 disabled:opacity-40">
                  {busy ? 'Saving…' : 'Save Draft'}
                </button>
                <Link
                  href={`/admin/a2h/topics?project=${project.id}`}
                  onClick={() => { void handleSaveDraft() }}
                  className="text-xs font-medium px-3.5 py-2 rounded-xl bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900"
                >
                  Continue to Topic Blueprint →
                </Link>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function Row({ label, value, emphasized = false, display }: { label: string; value: number; emphasized?: boolean; display?: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className={emphasized ? 'font-semibold text-gray-900 dark:text-gray-100 tabular-nums' : 'text-gray-700 dark:text-gray-300 tabular-nums'}>
        {display ?? value.toLocaleString()}
      </dd>
    </div>
  )
}

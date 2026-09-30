'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import {
  apiGetProject, apiListCorpus,
  apiListFixtureSets, apiCreateFixtureSet, apiGetFixtureSet, apiValidateFixtureSet, apiLockFixtureSet,
  apiListFixtures, apiCreateFixture, apiDeleteFixture, apiScanSourceForCandidates, apiSeedRepairFixtures,
  type CorpusProject, type CorpusSource, type FixtureSet, type BenchmarkFixture, type A2HFixtureType,
  type FixtureSetValidationResult, type FixtureCandidates,
} from '@/lib/a2hApi'
import { Spinner } from '@/components/ui/Spinner'

const FIXTURE_TYPE_LABEL: Record<A2HFixtureType, string> = {
  citation: 'Citation',
  numeric_unit: 'Numeric / Unit',
  modality: 'Modality',
  protected_term: 'Protected Term',
  terminology: 'Terminology',
  grammar_repair: 'Grammar Repair',
  factual_repair: 'Factual Repair',
}

// Fixture-set administration (§23-24) for a Corpus Project's A2H-04/05/09/
// 10/13 annotation layer. A fixture set is a first-class, versioned object
// scoped to one project (§2) — this page creates/selects one, shows
// coverage, and lets an admin review/add/approve fixtures per source while
// the set is still draft; once locked (§26), every mutation here is
// rejected server-side regardless of what this UI still shows.
export default function A2HFixturesPage() {
  const projectId = useSearchParams().get('project') ?? ''

  const [project, setProject] = useState<CorpusProject | null>(null)
  const [sources, setSources] = useState<CorpusSource[]>([])
  const [fixtureSets, setFixtureSets] = useState<FixtureSet[]>([])
  const [selectedSetId, setSelectedSetId] = useState<string>('')
  const [allFixtures, setAllFixtures] = useState<BenchmarkFixture[]>([])
  const [validationResult, setValidationResult] = useState<FixtureSetValidationResult | null>(null)

  const [selectedSourceId, setSelectedSourceId] = useState<string>('')
  const [sourceFixtures, setSourceFixtures] = useState<BenchmarkFixture[]>([])
  const [candidates, setCandidates] = useState<FixtureCandidates | null>(null)

  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [creatingSet, setCreatingSet] = useState(false)
  const [newSetName, setNewSetName] = useState('')
  const [termForm, setTermForm] = useState({ preferredTerm: '', allowedVariants: '', forbiddenVariants: '', caseSensitive: false })

  const selectedSet = fixtureSets.find(s => s.id === selectedSetId) ?? null
  const isDraft = selectedSet?.status === 'draft'
  const frozenSources = sources.filter(s => s.status === 'frozen')

  useEffect(() => {
    if (!projectId) { setError('No corpus project selected.'); setLoading(false); return }
    let cancelled = false
    Promise.all([apiGetProject(projectId), apiListCorpus(projectId), apiListFixtureSets(projectId)])
      .then(([p, s, fs]) => {
        if (cancelled) return
        setProject(p)
        setSources(s)
        setFixtureSets(fs)
        if (fs.length > 0) setSelectedSetId(fs[0]!.id)
      })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load fixtures.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [projectId])

  useEffect(() => {
    if (!selectedSetId) { setAllFixtures([]); return }
    let cancelled = false
    apiListFixtures(selectedSetId).then(fx => { if (!cancelled) setAllFixtures(fx) }).catch(() => {})
    return () => { cancelled = true }
  }, [selectedSetId])

  useEffect(() => {
    if (!selectedSetId || !selectedSourceId) { setSourceFixtures([]); return }
    let cancelled = false
    apiListFixtures(selectedSetId, selectedSourceId).then(fx => { if (!cancelled) setSourceFixtures(fx) }).catch(() => {})
    return () => { cancelled = true }
  }, [selectedSetId, selectedSourceId])

  async function refreshFixtures() {
    if (!selectedSetId) return
    const [all, forSource] = await Promise.all([
      apiListFixtures(selectedSetId),
      selectedSourceId ? apiListFixtures(selectedSetId, selectedSourceId) : Promise.resolve([]),
    ])
    setAllFixtures(all)
    setSourceFixtures(forSource)
  }

  async function handleCreateSet() {
    if (!newSetName.trim()) return
    setBusy(true)
    setError(null)
    try {
      const set = await apiCreateFixtureSet(projectId, newSetName.trim())
      setFixtureSets(prev => [set, ...prev])
      setSelectedSetId(set.id)
      setNewSetName('')
      setCreatingSet(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create fixture set.')
    } finally {
      setBusy(false)
    }
  }

  async function handleValidate() {
    if (!selectedSetId) return
    setBusy(true)
    setError(null)
    try {
      const result = await apiValidateFixtureSet(selectedSetId)
      setValidationResult(result)
      const updated = await apiGetFixtureSet(selectedSetId)
      setFixtureSets(prev => prev.map(s => (s.id === updated.id ? updated : s)))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Validation failed.')
    } finally {
      setBusy(false)
    }
  }

  async function handleLock() {
    if (!selectedSetId) return
    if (!window.confirm('Lock this fixture set? Once locked, no fixture in it can ever be added, edited, or deleted again.')) return
    setBusy(true)
    setError(null)
    try {
      const { set: locked, result } = await apiLockFixtureSet(selectedSetId)
      setValidationResult(result)
      setFixtureSets(prev => prev.map(s => (s.id === locked.id ? locked : s)))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lock failed.')
    } finally {
      setBusy(false)
    }
  }

  async function handleScan() {
    if (!selectedSetId || !selectedSourceId) return
    setBusy(true)
    setError(null)
    try {
      setCandidates(await apiScanSourceForCandidates(selectedSetId, selectedSourceId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Scan failed.')
    } finally {
      setBusy(false)
    }
  }

  async function handleSeedRepairFixtures(kind: 'grammar_repair' | 'factual_repair') {
    if (!selectedSetId || !selectedSourceId) return
    setBusy(true)
    setError(null)
    try {
      await apiSeedRepairFixtures(selectedSetId, selectedSourceId, kind)
      await refreshFixtures()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to seed fixtures.')
    } finally {
      setBusy(false)
    }
  }

  async function handleApprove(type: A2HFixtureType, expected: Record<string, unknown>) {
    if (!selectedSetId || !selectedSourceId) return
    setBusy(true)
    setError(null)
    try {
      await apiCreateFixture(selectedSetId, { sourceId: selectedSourceId, type, expected })
      await refreshFixtures()
      setCandidates(prev => prev && {
        ...prev,
        [type]: (prev[type as keyof FixtureCandidates] as Array<Record<string, unknown>>).filter(c => JSON.stringify(c) !== JSON.stringify(expected)),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add fixture.')
    } finally {
      setBusy(false)
    }
  }

  async function handleDeleteFixture(fixtureId: string) {
    if (!selectedSetId) return
    setBusy(true)
    setError(null)
    try {
      await apiDeleteFixture(selectedSetId, fixtureId)
      await refreshFixtures()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete fixture.')
    } finally {
      setBusy(false)
    }
  }

  async function handleAddTerminology() {
    if (!selectedSetId || !selectedSourceId || !termForm.preferredTerm.trim()) return
    setBusy(true)
    setError(null)
    try {
      await apiCreateFixture(selectedSetId, {
        sourceId: selectedSourceId,
        type: 'terminology',
        expected: {
          preferredTerm: termForm.preferredTerm.trim(),
          allowedVariants: termForm.allowedVariants.split(',').map(v => v.trim()).filter(Boolean),
          forbiddenVariants: termForm.forbiddenVariants.split(',').map(v => v.trim()).filter(Boolean),
          caseSensitive: termForm.caseSensitive,
          expectedMinimumOccurrences: null,
        },
      })
      setTermForm({ preferredTerm: '', allowedVariants: '', forbiddenVariants: '', caseSensitive: false })
      await refreshFixtures()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add terminology fixture.')
    } finally {
      setBusy(false)
    }
  }

  if (!projectId) {
    return (
      <div className="min-h-screen bg-white dark:bg-gray-950 p-6">
        <div className="max-w-3xl mx-auto text-sm text-gray-400 dark:text-gray-500 py-12 text-center">
          No corpus project selected. <Link href="/admin/a2h" className="underline hover:text-gray-700 dark:hover:text-gray-300">Pick one from the A2H home</Link>.
        </div>
      </div>
    )
  }

  const byType: Record<A2HFixtureType, number> = { citation: 0, numeric_unit: 0, modality: 0, protected_term: 0, terminology: 0, grammar_repair: 0, factual_repair: 0 }
  for (const f of allFixtures) byType[f.type]++
  const sourcesWithAnyFixture = new Set(allFixtures.map(f => f.sourceId)).size

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950 p-6">
      <div className="max-w-5xl mx-auto space-y-5">
        <div>
          <Link href={`/admin/a2h/corpus?project=${projectId}`} className="text-xs text-gray-400 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-300">← {project?.name ?? 'A2H Benchmark'}</Link>
          <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mt-1">A2H Fixture Set</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Citation, numeric/unit, modality, protected-term, and terminology annotations for A2H-04/05/09/10/13.</p>
        </div>

        {error && <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-xl px-4 py-2.5">{error}</div>}

        {loading ? (
          <div className="flex justify-center py-12"><Spinner className="w-6 h-6 border-gray-200 border-t-gray-700 dark:border-gray-700 dark:border-t-gray-300" /></div>
        ) : (
          <>
            <div className="border border-gray-200 dark:border-gray-800 rounded-2xl p-4 space-y-3">
              <div className="flex items-center gap-2">
                <select value={selectedSetId} onChange={e => setSelectedSetId(e.target.value)}
                  className="flex-1 text-sm rounded-xl px-3 py-2 bg-white border border-gray-300 text-gray-700 dark:bg-gray-900 dark:border-gray-700 dark:text-gray-300">
                  <option value="">Select a fixture set…</option>
                  {fixtureSets.map(fs => <option key={fs.id} value={fs.id}>{fs.name} · {fs.fixtureVersion} · {fs.status}</option>)}
                </select>
              </div>

              {creatingSet ? (
                <div className="flex items-center gap-2">
                  <input autoFocus value={newSetName} onChange={e => setNewSetName(e.target.value)} placeholder="e.g. A2H Standard Fixtures"
                    className="flex-1 text-sm rounded-xl px-3 py-2 bg-white border border-gray-300 text-gray-700 dark:bg-gray-900 dark:border-gray-700 dark:text-gray-300" />
                  <button onClick={handleCreateSet} disabled={busy || !newSetName.trim()} className="text-sm px-3.5 py-2 rounded-xl bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900 disabled:opacity-40">Create</button>
                  <button onClick={() => setCreatingSet(false)} className="text-sm text-gray-500 px-2">Cancel</button>
                </div>
              ) : (
                <button onClick={() => setCreatingSet(true)} className="w-full text-sm px-3.5 py-2 rounded-xl border border-dashed border-gray-300 dark:border-gray-700 text-gray-500 dark:text-gray-400">
                  + New Fixture Set
                </button>
              )}

              {selectedSet && (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs pt-2 border-t border-gray-100 dark:border-gray-900">
                    {Object.entries(FIXTURE_TYPE_LABEL).map(([type, label]) => (
                      <div key={type} className="flex justify-between">
                        <span className="text-gray-500 dark:text-gray-400">{label}</span>
                        <span className="tabular-nums text-gray-800 dark:text-gray-200 font-semibold">{byType[type as A2HFixtureType]}</span>
                      </div>
                    ))}
                    <div className="flex justify-between col-span-2 sm:col-span-3 pt-1 border-t border-gray-100 dark:border-gray-900">
                      <span className="text-gray-500 dark:text-gray-400">Sources with any fixture</span>
                      <span className="tabular-nums text-gray-800 dark:text-gray-200 font-semibold">{sourcesWithAnyFixture} / {frozenSources.length}</span>
                    </div>
                  </div>

                  {validationResult && !validationResult.ok && (
                    <div className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-xl px-3 py-2 space-y-0.5">
                      {validationResult.errors.slice(0, 10).map((e, i) => <p key={i}>• {e}</p>)}
                      {validationResult.errors.length > 10 && <p>…and {validationResult.errors.length - 10} more.</p>}
                    </div>
                  )}

                  <div className="flex gap-2">
                    <button onClick={handleValidate} disabled={busy || selectedSet.status === 'locked'}
                      className="text-xs font-medium px-3.5 py-2 rounded-xl border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 disabled:opacity-40">
                      Validate Fixture Set
                    </button>
                    <button onClick={handleLock} disabled={busy || selectedSet.status === 'locked'}
                      className="text-xs font-medium px-3.5 py-2 rounded-xl bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900 disabled:opacity-40">
                      {selectedSet.status === 'locked' ? 'Locked' : 'Lock Fixture Set'}
                    </button>
                  </div>
                </>
              )}
            </div>

            {selectedSet && (
              <div className="grid grid-cols-1 sm:grid-cols-[220px_1fr] gap-4">
                <div className="border border-gray-200 dark:border-gray-800 rounded-2xl p-2 max-h-[28rem] overflow-y-auto">
                  {frozenSources.map(source => (
                    <button key={source.id} onClick={() => { setSelectedSourceId(source.id); setCandidates(null) }}
                      className={`w-full text-left text-xs px-3 py-2 rounded-xl transition-colors ${selectedSourceId === source.id ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-900/50'}`}>
                      {source.domainId} · {source.targetWords}w
                    </button>
                  ))}
                </div>

                <div className="space-y-3">
                  {!selectedSourceId ? (
                    <p className="text-xs text-gray-400 dark:text-gray-500 p-4">Select a source to review its fixtures.</p>
                  ) : (
                    <>
                      <div className="border border-gray-200 dark:border-gray-800 rounded-2xl p-4 space-y-1.5">
                        <h2 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1">Fixtures</h2>
                        {sourceFixtures.length === 0 && <p className="text-xs text-gray-400 dark:text-gray-500">No fixtures yet for this source.</p>}
                        {sourceFixtures.map(f => (
                          <div key={f.id} className="flex items-center gap-2 text-xs">
                            <span className="w-24 shrink-0 text-gray-400 dark:text-gray-500">{FIXTURE_TYPE_LABEL[f.type]}</span>
                            <span className="flex-1 font-mono text-gray-700 dark:text-gray-300 truncate">{JSON.stringify(f.expected)}</span>
                            {isDraft && (
                              <button onClick={() => handleDeleteFixture(f.id)} disabled={busy} className="text-red-500 hover:text-red-700 disabled:opacity-40">Delete</button>
                            )}
                          </div>
                        ))}
                      </div>

                      {isDraft && (
                        <div className="border border-gray-200 dark:border-gray-800 rounded-2xl p-4 space-y-2">
                          <div className="flex items-center justify-between">
                            <h2 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Scan for Candidates</h2>
                            <button onClick={handleScan} disabled={busy} className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 disabled:opacity-40">Scan Source</button>
                          </div>
                          {candidates && (
                            <div className="space-y-2 max-h-56 overflow-y-auto">
                              {(['citation', 'numeric_unit', 'modality', 'protected_term'] as const).map(type => (
                                <div key={type}>
                                  {candidates[type].length > 0 && <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{FIXTURE_TYPE_LABEL[type]}</p>}
                                  {candidates[type].map((c, i) => (
                                    <div key={i} className="flex items-center gap-2 text-xs py-0.5">
                                      <span className="flex-1 font-mono text-gray-700 dark:text-gray-300 truncate">{JSON.stringify(c)}</span>
                                      <button onClick={() => handleApprove(type, c as unknown as Record<string, unknown>)} disabled={busy}
                                        className="text-xs px-2 py-1 rounded-lg bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900 disabled:opacity-40">Approve</button>
                                    </div>
                                  ))}
                                </div>
                              ))}
                            </div>
                          )}

                          <div className="pt-2 border-t border-gray-100 dark:border-gray-900 space-y-1.5">
                            <p className="text-xs text-gray-400 dark:text-gray-500">Add a terminology fixture (needs manual curation — no auto-scan):</p>
                            <input value={termForm.preferredTerm} onChange={e => setTermForm({ ...termForm, preferredTerm: e.target.value })} placeholder="Preferred term"
                              className="w-full text-xs rounded-lg px-2 py-1.5 bg-white border border-gray-300 dark:bg-gray-900 dark:border-gray-700 dark:text-gray-300" />
                            <input value={termForm.allowedVariants} onChange={e => setTermForm({ ...termForm, allowedVariants: e.target.value })} placeholder="Allowed variants (comma-separated)"
                              className="w-full text-xs rounded-lg px-2 py-1.5 bg-white border border-gray-300 dark:bg-gray-900 dark:border-gray-700 dark:text-gray-300" />
                            <input value={termForm.forbiddenVariants} onChange={e => setTermForm({ ...termForm, forbiddenVariants: e.target.value })} placeholder="Forbidden variants (comma-separated)"
                              className="w-full text-xs rounded-lg px-2 py-1.5 bg-white border border-gray-300 dark:bg-gray-900 dark:border-gray-700 dark:text-gray-300" />
                            <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400">
                              <input type="checkbox" checked={termForm.caseSensitive} onChange={e => setTermForm({ ...termForm, caseSensitive: e.target.checked })} />
                              Case sensitive
                            </label>
                            <button onClick={handleAddTerminology} disabled={busy || !termForm.preferredTerm.trim()}
                              className="text-xs px-3 py-1.5 rounded-lg bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900 disabled:opacity-40">Add Terminology Fixture</button>
                          </div>

                          <div className="pt-2 border-t border-gray-100 dark:border-gray-900 space-y-1.5">
                            <p className="text-xs text-gray-400 dark:text-gray-500">Seed the curated grammar/factual repair regression set onto this source (review before locking):</p>
                            <div className="flex gap-2">
                              <button onClick={() => handleSeedRepairFixtures('grammar_repair')} disabled={busy}
                                className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 disabled:opacity-40">
                                Seed Grammar Fixtures
                              </button>
                              <button onClick={() => handleSeedRepairFixtures('factual_repair')} disabled={busy}
                                className="text-xs px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 disabled:opacity-40">
                                Seed Factual Fixtures
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

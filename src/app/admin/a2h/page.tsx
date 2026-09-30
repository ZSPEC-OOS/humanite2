'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { apiListProjects, apiCreateProject, apiDuplicateProject, apiArchiveProject, apiDeleteProject, type CorpusProject } from '@/lib/a2hApi'
import { Spinner } from '@/components/ui/Spinner'
import { SlideToConfirm } from '@/components/ui/SlideToConfirm'

const STATUS_LABEL: Record<CorpusProject['status'], string> = {
  draft: 'Draft',
  blueprint_locked: 'Blueprint Locked',
  generating: 'Generating',
  frozen: 'Frozen',
  archived: 'Archived',
}

// Landing page for the A2H benchmark admin area — access is already gated
// by layout.tsx. Everything downstream (topics, corpus sources, detector
// results, Humanite outputs) is scoped to a Corpus Project; this is where
// an admin picks, creates, duplicates, or archives one before opening its
// configuration/generation pages.
export default function A2HAdminPage() {
  const router = useRouter()
  const [projects, setProjects] = useState<CorpusProject[]>([])
  const [selectedId, setSelectedId] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  useEffect(() => {
    let cancelled = false
    apiListProjects()
      .then(data => {
        if (cancelled) return
        setProjects(data)
        if (data.length > 0) setSelectedId(data[0]!.id)
      })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load corpus projects.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const selected = projects.find(p => p.id === selectedId)

  async function handleCreate() {
    if (!newName.trim()) return
    setBusy(true)
    setError(null)
    try {
      const project = await apiCreateProject(newName.trim())
      router.push(`/admin/a2h/corpus-design?project=${project.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create corpus project.')
      setBusy(false)
    }
  }

  async function handleDuplicate() {
    if (!selected) return
    const name = window.prompt('Name for the duplicated corpus project:', `${selected.name} (copy)`)
    if (!name || !name.trim()) return
    setBusy(true)
    setError(null)
    try {
      const project = await apiDuplicateProject(selected.id, name.trim())
      setProjects(prev => [project, ...prev])
      setSelectedId(project.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to duplicate corpus project.')
    } finally {
      setBusy(false)
    }
  }

  async function handleArchive() {
    if (!selected) return
    if (!window.confirm(`Archive "${selected.name}"? It stays viewable but is no longer active.`)) return
    setBusy(true)
    setError(null)
    try {
      const project = await apiArchiveProject(selected.id)
      setProjects(prev => prev.map(p => (p.id === project.id ? project : p)))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to archive corpus project.')
    } finally {
      setBusy(false)
    }
  }

  async function handleDeletePermanently() {
    if (!selected) return
    setBusy(true)
    setError(null)
    try {
      await apiDeleteProject(selected.id, selected.name)
      setProjects(prev => {
        const remaining = prev.filter(p => p.id !== selected.id)
        setSelectedId(remaining[0]?.id ?? '')
        return remaining
      })
      setConfirmingDelete(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete corpus project.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950 flex items-center justify-center p-6">
      <div className="max-w-md w-full space-y-4">
        <div className="text-center">
          <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100">A2H Benchmark</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Corpus generation, run execution, and analysis tooling.
          </p>
        </div>

        {error && (
          <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-xl px-4 py-2.5">{error}</div>
        )}

        {loading ? (
          <div className="flex justify-center py-8">
            <Spinner className="w-6 h-6 border-gray-200 border-t-gray-700 dark:border-gray-700 dark:border-t-gray-300" />
          </div>
        ) : (
          <div className="border border-gray-200 dark:border-gray-800 rounded-2xl p-4 space-y-3">
            <div>
              <label className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Corpus Project</label>
              {projects.length === 0 ? (
                <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">No corpus projects yet.</p>
              ) : (
                <select
                  value={selectedId}
                  onChange={e => setSelectedId(e.target.value)}
                  className="w-full mt-1 text-sm rounded-xl px-3 py-2 bg-white border border-gray-300 text-gray-700 dark:bg-gray-900 dark:border-gray-700 dark:text-gray-300 focus:outline-none focus:border-gray-900 dark:focus:border-gray-100"
                >
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              )}
            </div>

            {selected && (
              <p className="text-sm text-gray-500 dark:text-gray-400">Status: {STATUS_LABEL[selected.status]}</p>
            )}

            {selected && (
              <div className="flex flex-wrap gap-2">
                <Link href={`/admin/a2h/corpus-design?project=${selected.id}`}
                  className="text-sm px-3.5 py-2 rounded-xl bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900 hover:opacity-90 transition-opacity">
                  Open Corpus
                </Link>
                {selected.status === 'frozen' && (
                  <Link href={`/admin/a2h/benchmark?project=${selected.id}`}
                    className="text-sm px-3.5 py-2 rounded-xl border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors">
                    Benchmark Runs
                  </Link>
                )}
                <button onClick={handleDuplicate} disabled={busy}
                  className="text-sm px-3.5 py-2 rounded-xl border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 disabled:opacity-40">
                  Duplicate Corpus
                </button>
                {selected.status !== 'archived' && (
                  <button onClick={handleArchive} disabled={busy}
                    className="text-sm px-3.5 py-2 rounded-xl border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 disabled:opacity-40">
                    Archive
                  </button>
                )}
              </div>
            )}

            {selected && (
              <div className="border-t border-gray-100 dark:border-gray-900 pt-3">
                {confirmingDelete ? (
                  <div className="space-y-2">
                    <p className="text-xs text-red-600 dark:text-red-400">
                      Permanently delete &ldquo;{selected.name}&rdquo;? This removes every topic, source, run, and result tied to it. This cannot be undone.
                    </p>
                    <SlideToConfirm
                      label="Slide to delete permanently"
                      confirmingLabel="Release to delete"
                      onConfirm={handleDeletePermanently}
                      disabled={busy}
                    />
                    <button onClick={() => setConfirmingDelete(false)} disabled={busy}
                      className="w-full text-sm px-3.5 py-2 rounded-xl border border-gray-300 dark:border-gray-700 text-gray-500 dark:text-gray-400 disabled:opacity-40">
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button onClick={() => setConfirmingDelete(true)} disabled={busy}
                    className="w-full text-sm px-3.5 py-2 rounded-xl border border-red-200 dark:border-red-900/60 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors disabled:opacity-40">
                    Delete Permanently
                  </button>
                )}
              </div>
            )}

            <div className="border-t border-gray-100 dark:border-gray-900 pt-3">
              {creating ? (
                <div className="flex items-center gap-2">
                  <input
                    autoFocus value={newName} onChange={e => setNewName(e.target.value)}
                    placeholder="e.g. A2H Standard Research Corpus V1"
                    className="flex-1 text-sm rounded-xl px-3 py-2 bg-white border border-gray-300 text-gray-700 dark:bg-gray-900 dark:border-gray-700 dark:text-gray-300 focus:outline-none focus:border-gray-900 dark:focus:border-gray-100"
                  />
                  <button onClick={handleCreate} disabled={busy || !newName.trim()}
                    className="text-sm px-3.5 py-2 rounded-xl bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900 disabled:opacity-40">
                    {busy ? 'Creating…' : 'Create'}
                  </button>
                </div>
              ) : (
                <button onClick={() => setCreating(true)}
                  className="w-full text-sm px-3.5 py-2 rounded-xl border border-dashed border-gray-300 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-900 transition-colors">
                  + New Corpus
                </button>
              )}
            </div>
          </div>
        )}

        <Link href="/dashboard" className="block text-center text-sm text-gray-400 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-300">
          Back to dashboard
        </Link>
      </div>
    </div>
  )
}

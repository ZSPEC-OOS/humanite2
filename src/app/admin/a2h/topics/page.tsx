'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { type Domain } from '@/lib/style/types'
import { MAX_TOPICS_PER_DOMAIN, DOMAIN_CODE, DEFAULT_GENERATION_PROMPT_VERSION } from '@/lib/a2h/types'
import {
  apiGetProject, apiListTopics, apiCreateTopic, apiUpdateTopic,
  apiGenerateOutline, apiExpandOutline,
  type BenchmarkTopic, type CorpusProject,
} from '@/lib/a2hApi'
import { Spinner } from '@/components/ui/Spinner'

const inputCls = `w-full text-sm rounded-xl px-3.5 py-2 bg-white border border-gray-300 text-gray-700
                  dark:bg-gray-900 dark:border-gray-700 dark:text-gray-300
                  focus:outline-none focus:border-gray-900 dark:focus:border-gray-100`

interface FormState {
  topicNumber: string
  title: string
  description: string
  intendedAudience: string
  writingType: string
  coreConcepts: string
  generationPromptVersion: string
}

const EMPTY_FORM: FormState = {
  topicNumber: '',
  title: '',
  description: '',
  intendedAudience: '',
  writingType: '',
  coreConcepts: '',
  generationPromptVersion: DEFAULT_GENERATION_PROMPT_VERSION,
}

function topicToForm(topic: BenchmarkTopic): FormState {
  return {
    topicNumber: String(topic.topicNumber),
    title: topic.title,
    description: topic.description,
    intendedAudience: topic.intendedAudience,
    writingType: topic.writingType,
    coreConcepts: topic.coreConcepts.join(', '),
    generationPromptVersion: topic.generationPromptVersion,
  }
}

export default function A2HTopicsPage() {
  const projectId = useSearchParams().get('project')

  const [project, setProject] = useState<CorpusProject | null>(null)
  const [domain, setDomain] = useState<Domain | null>(null)
  const [topics, setTopics] = useState<BenchmarkTopic[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [outlineBusy, setOutlineBusy] = useState(false)

  useEffect(() => {
    if (!projectId) { setLoading(false); return }
    let cancelled = false
    apiGetProject(projectId)
      .then(p => {
        if (cancelled) return
        setProject(p)
        setDomain(p.domains[0] ?? null)
      })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load corpus project.') })
    return () => { cancelled = true }
  }, [projectId])

  useEffect(() => {
    if (!projectId || !domain) { setLoading(false); return }
    let cancelled = false
    setLoading(true)
    setError(null)
    setEditingId(null)
    apiListTopics(projectId, domain)
      .then(data => { if (!cancelled) setTopics(data) })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load topics.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [projectId, domain])

  const isDraft = project?.status === 'draft'
  const targetCount = (domain && project?.topicCountByDomain[domain]) ?? 0

  async function handleGenerateOutline(force: boolean) {
    if (!projectId || !domain) return
    if (force && !window.confirm(`Regenerate the outline for ${domain}? This replaces all ${topics.length} existing topics.`)) {
      return
    }
    setOutlineBusy(true)
    setError(null)
    try {
      const generated = await apiGenerateOutline(projectId, domain, force)
      setTopics([...generated].sort((a, b) => a.topicNumber - b.topicNumber))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Outline generation failed.')
    } finally {
      setOutlineBusy(false)
    }
  }

  // Appends new topics up to the project's configured count for this domain
  // — never touches the existing roster, unlike handleGenerateOutline(true)
  // which wipes and rerolls everything.
  async function handleExpandOutline() {
    if (!projectId || !domain) return
    setOutlineBusy(true)
    setError(null)
    try {
      const additional = await apiExpandOutline(projectId, domain)
      setTopics(prev => [...prev, ...additional].sort((a, b) => a.topicNumber - b.topicNumber))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Outline expansion failed.')
    } finally {
      setOutlineBusy(false)
    }
  }

  function startAdd() {
    setEditingId('__new__')
    setForm({ ...EMPTY_FORM, topicNumber: String(topics.length + 1) })
  }

  function startEdit(topic: BenchmarkTopic) {
    setEditingId(topic.id)
    setForm(topicToForm(topic))
  }

  async function submit() {
    if (!projectId || !domain) return
    setSaving(true)
    setError(null)
    try {
      const coreConcepts = form.coreConcepts.split(',').map(c => c.trim()).filter(Boolean)
      if (editingId === '__new__') {
        const created = await apiCreateTopic({
          corpusProjectId: projectId,
          domainId: domain,
          topicNumber: Number(form.topicNumber),
          title: form.title.trim(),
          description: form.description.trim(),
          intendedAudience: form.intendedAudience.trim(),
          writingType: form.writingType.trim(),
          coreConcepts,
          generationPromptVersion: form.generationPromptVersion.trim(),
        })
        setTopics(prev => [...prev, created].sort((a, b) => a.topicNumber - b.topicNumber))
      } else if (editingId) {
        const updated = await apiUpdateTopic(editingId, {
          title: form.title.trim(),
          description: form.description.trim(),
          intendedAudience: form.intendedAudience.trim(),
          writingType: form.writingType.trim(),
          coreConcepts,
          generationPromptVersion: form.generationPromptVersion.trim(),
        })
        setTopics(prev => prev.map(t => (t.id === editingId ? updated : t)))
      }
      setEditingId(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  async function toggleEnabled(topic: BenchmarkTopic) {
    const updated = await apiUpdateTopic(topic.id, { enabled: !topic.enabled })
    setTopics(prev => prev.map(t => (t.id === topic.id ? updated : t)))
  }

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
      <div className="max-w-4xl mx-auto space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <Link href={`/admin/a2h/corpus-design?project=${projectId}`} className="text-xs text-gray-400 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-300">
              ← {project?.name ?? 'Corpus Design'}
            </Link>
            <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mt-1">Topic Blueprint</h1>
            {domain && <p className="text-sm text-gray-500 dark:text-gray-400">{topics.length} / {targetCount} defined for {domain}</p>}
          </div>
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

        {!isDraft && project && (
          <div className="text-xs text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-gray-900/50 rounded-xl px-4 py-2.5">
            This project&rsquo;s blueprint is {project.status} — the topic roster is read-only.
          </div>
        )}

        {isDraft && domain && targetCount > 0 && (
          <div className="border border-gray-200 dark:border-gray-800 rounded-2xl p-4 flex items-center justify-between flex-wrap gap-3">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {topics.length === 0
                ? `Generate ${targetCount} topic families for ${domain} in one call.`
                : topics.length < targetCount
                  ? `${topics.length} of ${targetCount} generated — ${targetCount - topics.length} additional needed.`
                  : `${topics.length} topics generated for ${domain}.`}
            </p>
            <div className="flex items-center gap-2">
              {topics.length < targetCount && (
                <button
                  onClick={topics.length === 0 ? () => handleGenerateOutline(false) : handleExpandOutline}
                  disabled={outlineBusy}
                  className="text-xs font-medium px-3.5 py-2 rounded-xl bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900 disabled:opacity-40"
                >
                  {outlineBusy
                    ? 'Generating…'
                    : topics.length === 0
                      ? `Generate ${targetCount} Unique Topics`
                      : `Generate ${targetCount - topics.length} Additional Topics`}
                </button>
              )}
              {topics.length > 0 && (
                <button
                  onClick={() => handleGenerateOutline(true)}
                  disabled={outlineBusy}
                  className="text-xs font-medium px-3.5 py-2 rounded-xl border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 disabled:opacity-40"
                >
                  {outlineBusy ? 'Working…' : 'Regenerate All'}
                </button>
              )}
            </div>
          </div>
        )}

        {isDraft && domain && targetCount === 0 && (
          <div className="text-xs text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-gray-900/50 rounded-xl px-4 py-2.5">
            Set a topic count for {domain} on the Corpus Design page before generating an outline.
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-12">
            <Spinner className="w-6 h-6 border-gray-200 border-t-gray-700 dark:border-gray-700 dark:border-t-gray-300" />
          </div>
        ) : (
          <div className="border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden">
            {topics.map(topic => (
              <div key={topic.id} className="border-b border-gray-200 dark:border-gray-800 last:border-b-0">
                <div className="flex items-center justify-between px-4 py-3">
                  <div className="min-w-0">
                    <span className="text-xs text-gray-400 dark:text-gray-500 mr-2 font-mono">
                      {DOMAIN_CODE[topic.domainId]}-{String(topic.topicNumber).padStart(2, '0')}
                    </span>
                    <span className="text-sm text-gray-800 dark:text-gray-200">{topic.title}</span>
                    {!topic.enabled && <span className="ml-2 text-xs text-amber-600 dark:text-amber-400">disabled</span>}
                  </div>
                  {isDraft && (
                    <div className="flex items-center gap-3 shrink-0">
                      <button onClick={() => toggleEnabled(topic)} className="text-xs text-gray-400 hover:text-gray-700 dark:hover:text-gray-300">
                        {topic.enabled ? 'Disable' : 'Enable'}
                      </button>
                      <button onClick={() => startEdit(topic)} className="text-xs text-gray-500 hover:text-gray-900 dark:hover:text-gray-100">Edit</button>
                    </div>
                  )}
                </div>
                {editingId === topic.id && (
                  <TopicForm form={form} setForm={setForm} onSubmit={submit} onCancel={() => setEditingId(null)} saving={saving} showTopicNumber={false} />
                )}
              </div>
            ))}
            {topics.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-gray-400 dark:text-gray-500">No topics yet for this domain.</div>
            )}
          </div>
        )}

        {isDraft && (
          editingId === '__new__' ? (
            <div className="border border-gray-200 dark:border-gray-800 rounded-2xl">
              <TopicForm form={form} setForm={setForm} onSubmit={submit} onCancel={() => setEditingId(null)} saving={saving} showTopicNumber />
            </div>
          ) : (
            topics.length < Math.max(targetCount, topics.length) + 1 && (
              <button
                onClick={startAdd}
                className="w-full text-sm text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100
                           border border-dashed border-gray-300 dark:border-gray-700 rounded-2xl py-3 transition-colors"
              >
                + Add topic
              </button>
            )
          )
        )}
      </div>
    </div>
  )
}

function TopicForm({
  form, setForm, onSubmit, onCancel, saving, showTopicNumber,
}: {
  form: FormState
  setForm: (f: FormState) => void
  onSubmit: () => void
  onCancel: () => void
  saving: boolean
  showTopicNumber: boolean
}) {
  const canSubmit = form.title.trim() && form.description.trim() && form.intendedAudience.trim()
    && form.writingType.trim() && form.coreConcepts.trim() && form.generationPromptVersion.trim()
    && (!showTopicNumber || Number(form.topicNumber) >= 1)

  return (
    <div className="px-4 py-4 space-y-3 bg-gray-50 dark:bg-gray-900/50">
      {showTopicNumber && (
        <Field label="Topic number">
          <input type="number" min={1} max={MAX_TOPICS_PER_DOMAIN} value={form.topicNumber}
            onChange={e => setForm({ ...form, topicNumber: e.target.value })} className={inputCls} />
        </Field>
      )}
      <Field label="Title">
        <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} className={inputCls} />
      </Field>
      <Field label="Description">
        <textarea rows={2} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className={inputCls} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Intended audience">
          <input value={form.intendedAudience} onChange={e => setForm({ ...form, intendedAudience: e.target.value })} className={inputCls} />
        </Field>
        <Field label="Writing type">
          <input value={form.writingType} onChange={e => setForm({ ...form, writingType: e.target.value })} placeholder="e.g. explainer article" className={inputCls} />
        </Field>
      </div>
      <Field label="Core concepts (comma-separated)">
        <input value={form.coreConcepts} onChange={e => setForm({ ...form, coreConcepts: e.target.value })} className={inputCls} />
      </Field>
      <Field label="Generation prompt version">
        <input value={form.generationPromptVersion} onChange={e => setForm({ ...form, generationPromptVersion: e.target.value })} className={inputCls} />
      </Field>
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={onSubmit}
          disabled={!canSubmit || saving}
          className="text-xs font-medium px-3.5 py-2 rounded-xl bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900 disabled:opacity-40 transition-opacity"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button onClick={onCancel} className="text-xs text-gray-500 hover:text-gray-800 dark:hover:text-gray-300 px-3.5 py-2">Cancel</button>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1 block">{label}</span>
      {children}
    </label>
  )
}

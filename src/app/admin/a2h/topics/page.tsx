'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { DOMAINS, type Domain } from '@/lib/style/types'
import { TOPICS_PER_DOMAIN, MAX_TOPICS_PER_DOMAIN, DOMAIN_CODE, DEFAULT_GENERATION_PROMPT_VERSION } from '@/lib/a2h/types'
import {
  apiListTopics, apiCreateTopic, apiUpdateTopic,
  apiGetDomainConfig, apiSaveDomainTopicCount, apiLockDomain, apiUnlockDomain,
  apiGenerateOutline, apiExpandOutline, apiRaiseDomainTopicCount,
  type BenchmarkTopic, type DomainOutlineConfig,
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
  const [domain, setDomain] = useState<Domain>('general')
  const [topics, setTopics] = useState<BenchmarkTopic[]>([])
  const [domainConfig, setDomainConfig] = useState<DomainOutlineConfig | null>(null)
  const [countInput, setCountInput] = useState(String(TOPICS_PER_DOMAIN))
  const [raiseInput, setRaiseInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [countBusy, setCountBusy] = useState(false)
  const [outlineBusy, setOutlineBusy] = useState(false)

  const targetCount = domainConfig?.topicCount ?? TOPICS_PER_DOMAIN

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setEditingId(null)
    Promise.all([apiListTopics(domain), apiGetDomainConfig(domain)])
      .then(([topicsData, config]) => {
        if (cancelled) return
        setTopics(topicsData)
        setDomainConfig(config)
        setCountInput(String(config?.topicCount ?? TOPICS_PER_DOMAIN))
        setRaiseInput(String((config?.topicCount ?? TOPICS_PER_DOMAIN) + 10))
      })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load topics.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [domain])

  async function handleSaveCount() {
    setCountBusy(true)
    setError(null)
    try {
      const config = await apiSaveDomainTopicCount(domain, Number(countInput))
      setDomainConfig(config)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.')
    } finally {
      setCountBusy(false)
    }
  }

  async function handleLockCount() {
    setCountBusy(true)
    setError(null)
    try {
      const config = await apiLockDomain(domain, Number(countInput))
      setDomainConfig(config)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lock failed.')
    } finally {
      setCountBusy(false)
    }
  }

  async function handleUnlockCount() {
    setCountBusy(true)
    setError(null)
    try {
      const config = await apiUnlockDomain(domain)
      setDomainConfig(config)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unlock failed.')
    } finally {
      setCountBusy(false)
    }
  }

  async function handleGenerateOutline(force: boolean) {
    if (force && !window.confirm(`Regenerate the outline for ${domain}? This replaces all ${topics.length} existing topics.`)) {
      return
    }
    setOutlineBusy(true)
    setError(null)
    try {
      const generated = await apiGenerateOutline(domain, force)
      setTopics([...generated].sort((a, b) => a.topicNumber - b.topicNumber))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Outline generation failed.')
    } finally {
      setOutlineBusy(false)
    }
  }

  // Appends new topics up to the (already-raised) locked count — never
  // touches the existing roster, unlike handleGenerateOutline(true) which
  // wipes and rerolls everything.
  async function handleExpandOutline() {
    setOutlineBusy(true)
    setError(null)
    try {
      const additional = await apiExpandOutline(domain)
      setTopics(prev => [...prev, ...additional].sort((a, b) => a.topicNumber - b.topicNumber))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Outline expansion failed.')
    } finally {
      setOutlineBusy(false)
    }
  }

  async function handleRaiseCount() {
    setCountBusy(true)
    setError(null)
    try {
      const config = await apiRaiseDomainTopicCount(domain, Number(raiseInput))
      setDomainConfig(config)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Raise failed.')
    } finally {
      setCountBusy(false)
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
    setSaving(true)
    setError(null)
    try {
      const coreConcepts = form.coreConcepts.split(',').map(c => c.trim()).filter(Boolean)
      if (editingId === '__new__') {
        const created = await apiCreateTopic({
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

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950 p-6">
      <div className="max-w-4xl mx-auto space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <Link href="/admin/a2h" className="text-xs text-gray-400 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-300">← A2H Benchmark</Link>
            <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mt-1">Topic Outlines</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {topics.length} / {targetCount} defined for {domain}
            </p>
          </div>
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

        {/* Topic count + outline generation */}
        <div className="border border-gray-200 dark:border-gray-800 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h2 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Unique topic outlines per domain</h2>
              {domainConfig?.locked ? (
                <p className="text-sm text-gray-700 dark:text-gray-300 mt-1">{domainConfig.topicCount} · locked</p>
              ) : (
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Default {TOPICS_PER_DOMAIN} — lock a count before generating an outline</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              {domainConfig?.locked ? (
                <button
                  onClick={handleUnlockCount}
                  disabled={countBusy || topics.length > 0}
                  title={topics.length > 0 ? 'Delete this domain\'s topics before unlocking' : undefined}
                  className="text-xs font-medium px-3.5 py-2 rounded-xl border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 disabled:opacity-40"
                >
                  {countBusy ? 'Working…' : 'Unlock'}
                </button>
              ) : (
                <>
                  <input
                    type="number" min={1} max={MAX_TOPICS_PER_DOMAIN} value={countInput}
                    onChange={e => setCountInput(e.target.value)}
                    className="w-20 text-sm rounded-xl px-3 py-2 bg-white border border-gray-300 text-gray-700 dark:bg-gray-900 dark:border-gray-700 dark:text-gray-300 focus:outline-none focus:border-gray-900 dark:focus:border-gray-100"
                  />
                  <button onClick={handleSaveCount} disabled={countBusy}
                    className="text-xs font-medium px-3.5 py-2 rounded-xl border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 disabled:opacity-40">
                    Save
                  </button>
                  <button onClick={handleLockCount} disabled={countBusy}
                    className="text-xs font-medium px-3.5 py-2 rounded-xl bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900 disabled:opacity-40">
                    {countBusy ? 'Working…' : 'Lock'}
                  </button>
                </>
              )}
            </div>
          </div>

          {domainConfig?.locked && (
            <div className="border-t border-gray-200 dark:border-gray-800 pt-3 space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {topics.length === 0
                    ? `Generate ${domainConfig.topicCount} topic families for ${domain} in one call.`
                    : topics.length < domainConfig.topicCount
                      ? `${topics.length} of ${domainConfig.topicCount} generated — ${domainConfig.topicCount - topics.length} additional needed.`
                      : `${topics.length} topics generated for ${domain}.`}
                </p>
                <div className="flex items-center gap-2">
                  {topics.length < domainConfig.topicCount && (
                    <button
                      onClick={topics.length === 0 ? () => handleGenerateOutline(false) : handleExpandOutline}
                      disabled={outlineBusy}
                      className="text-xs font-medium px-3.5 py-2 rounded-xl bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900 disabled:opacity-40"
                    >
                      {outlineBusy
                        ? 'Generating…'
                        : topics.length === 0
                          ? `Generate ${domainConfig.topicCount} Unique Topics`
                          : `Generate ${domainConfig.topicCount - topics.length} Additional Topics`}
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

              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400 dark:text-gray-500">Raise count to</span>
                <input
                  type="number" min={domainConfig.topicCount + 1} max={MAX_TOPICS_PER_DOMAIN} value={raiseInput}
                  onChange={e => setRaiseInput(e.target.value)}
                  className="w-20 text-sm rounded-xl px-3 py-1.5 bg-white border border-gray-300 text-gray-700 dark:bg-gray-900 dark:border-gray-700 dark:text-gray-300 focus:outline-none focus:border-gray-900 dark:focus:border-gray-100"
                />
                <button
                  onClick={handleRaiseCount}
                  disabled={countBusy || !(Number(raiseInput) > domainConfig.topicCount)}
                  className="text-xs font-medium px-3 py-1.5 rounded-xl border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 disabled:opacity-40"
                >
                  {countBusy ? 'Working…' : 'Raise'}
                </button>
              </div>
            </div>
          )}
        </div>

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
                  <div className="flex items-center gap-3 shrink-0">
                    <button onClick={() => toggleEnabled(topic)} className="text-xs text-gray-400 hover:text-gray-700 dark:hover:text-gray-300">
                      {topic.enabled ? 'Disable' : 'Enable'}
                    </button>
                    <button onClick={() => startEdit(topic)} className="text-xs text-gray-500 hover:text-gray-900 dark:hover:text-gray-100">Edit</button>
                  </div>
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

        {editingId === '__new__' ? (
          <div className="border border-gray-200 dark:border-gray-800 rounded-2xl">
            <TopicForm form={form} setForm={setForm} onSubmit={submit} onCancel={() => setEditingId(null)} saving={saving} showTopicNumber />
          </div>
        ) : (
          topics.length < targetCount && (
            <button
              onClick={startAdd}
              className="w-full text-sm text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100
                         border border-dashed border-gray-300 dark:border-gray-700 rounded-2xl py-3 transition-colors"
            >
              + Add topic
            </button>
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

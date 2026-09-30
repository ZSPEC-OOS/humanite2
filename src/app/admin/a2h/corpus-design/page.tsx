'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { DOMAINS, type Domain } from '@/lib/style/types'
import { DEFAULT_LENGTH_LADDER } from '@/lib/a2h/types'
import {
  apiGetLengthLadder, apiSaveLengthLadder, apiLockLengthLadder, apiExpandLengthLadder,
  apiGetDomainConfig,
  type LengthLadderConfig, type DomainOutlineConfig,
} from '@/lib/a2hApi'
import { Spinner } from '@/components/ui/Spinner'

const INTENSITY_COUNT = 10

export default function A2HCorpusDesignPage() {
  const [ladderConfig, setLadderConfig] = useState<LengthLadderConfig | null>(null)
  const [ladderDraft, setLadderDraft] = useState<number[]>([...DEFAULT_LENGTH_LADDER])
  const [newLength, setNewLength] = useState('')
  const [ladderBusy, setLadderBusy] = useState(false)
  const [domainConfigs, setDomainConfigs] = useState<Partial<Record<Domain, DomainOutlineConfig | null>>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all([apiGetLengthLadder(), ...DOMAINS.map(d => apiGetDomainConfig(d))])
      .then(([ladder, ...configs]) => {
        if (cancelled) return
        setLadderConfig(ladder)
        setLadderDraft(ladder?.ladder ?? [...DEFAULT_LENGTH_LADDER])
        const map: Partial<Record<Domain, DomainOutlineConfig | null>> = {}
        DOMAINS.forEach((d, i) => { map[d] = configs[i] as DomainOutlineConfig | null })
        setDomainConfigs(map)
      })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load corpus design.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  function applyPreset() {
    setLadderDraft([...DEFAULT_LENGTH_LADDER])
  }

  function addDraftLength() {
    const n = Number(newLength)
    if (!Number.isInteger(n) || n <= 0) {
      setError('Enter a positive whole number.')
      return
    }
    if (ladderDraft.includes(n)) {
      setError(`${n} is already in the ladder.`)
      return
    }
    setError(null)
    setLadderDraft(prev => [...prev, n].sort((a, b) => a - b))
    setNewLength('')
  }

  function removeDraftLength(n: number) {
    setLadderDraft(prev => prev.filter(x => x !== n))
  }

  async function handleSaveLadder() {
    setLadderBusy(true)
    setError(null)
    try {
      setLadderConfig(await apiSaveLengthLadder(ladderDraft))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.')
    } finally {
      setLadderBusy(false)
    }
  }

  async function handleLockLadder() {
    setLadderBusy(true)
    setError(null)
    try {
      setLadderConfig(await apiLockLengthLadder(ladderDraft))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Lock failed.')
    } finally {
      setLadderBusy(false)
    }
  }

  async function handleExpandLadder() {
    const n = Number(newLength)
    if (!Number.isInteger(n) || n <= 0) {
      setError('Enter a positive whole number to add.')
      return
    }
    setLadderBusy(true)
    setError(null)
    try {
      const config = await apiExpandLengthLadder([n])
      setLadderConfig(config)
      setLadderDraft(config.ladder)
      setNewLength('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Expand failed.')
    } finally {
      setLadderBusy(false)
    }
  }

  const activeLadder = ladderConfig?.locked ? ladderConfig.ladder : ladderDraft
  const perDomainCounts = DOMAINS.map(d => domainConfigs[d]?.topicCount ?? 0)
  const totalTopics = perDomainCounts.reduce((a, b) => a + b, 0)
  const totalSources = totalTopics * activeLadder.length
  const totalOutputs = totalSources * INTENSITY_COUNT
  const totalGptZero = totalSources + totalOutputs

  return (
    <div className="min-h-screen bg-white dark:bg-gray-950 p-6">
      <div className="max-w-3xl mx-auto space-y-5">
        <div>
          <Link href="/admin/a2h" className="text-xs text-gray-400 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-300">← A2H Benchmark</Link>
          <h1 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mt-1">Corpus Design</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Sources = Σ(unique topics per domain) × length ladder. Configure each independently below.
          </p>
        </div>

        {error && (
          <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-xl px-4 py-2.5">{error}</div>
        )}

        {loading ? (
          <div className="flex justify-center py-12">
            <Spinner className="w-6 h-6 border-gray-200 border-t-gray-700 dark:border-gray-700 dark:border-t-gray-300" />
          </div>
        ) : (
          <>
            {/* Length ladder */}
            <div className="border border-gray-200 dark:border-gray-800 rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <h2 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Length Ladder</h2>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                    {ladderConfig?.locked ? `${ladderConfig.ladder.length} lengths · locked` : `${ladderDraft.length} lengths (draft) — lock before generating corpus`}
                  </p>
                </div>
                {!ladderConfig?.locked && (
                  <button onClick={applyPreset} className="text-xs text-gray-500 hover:text-gray-800 dark:hover:text-gray-300 underline">
                    Reset to A2H Standard (10)
                  </button>
                )}
              </div>

              <div className="flex flex-wrap gap-1.5">
                {(ladderConfig?.locked ? ladderConfig.ladder : ladderDraft).map(len => (
                  <span
                    key={len}
                    className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1.5 rounded-lg bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
                  >
                    {len}
                    {!ladderConfig?.locked && (
                      <button onClick={() => removeDraftLength(len)} className="text-gray-400 hover:text-gray-800 dark:hover:text-gray-100">×</button>
                    )}
                  </span>
                ))}
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="number" min={1} placeholder="e.g. 400" value={newLength}
                  onChange={e => setNewLength(e.target.value)}
                  className="w-24 text-sm rounded-xl px-3 py-1.5 bg-white border border-gray-300 text-gray-700 dark:bg-gray-900 dark:border-gray-700 dark:text-gray-300 focus:outline-none focus:border-gray-900 dark:focus:border-gray-100"
                />
                {ladderConfig?.locked ? (
                  <button onClick={handleExpandLadder} disabled={ladderBusy}
                    className="text-xs font-medium px-3 py-1.5 rounded-xl border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 disabled:opacity-40">
                    {ladderBusy ? 'Working…' : '+ Add Length'}
                  </button>
                ) : (
                  <button onClick={addDraftLength}
                    className="text-xs font-medium px-3 py-1.5 rounded-xl border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300">
                    + Add Length
                  </button>
                )}
              </div>

              {!ladderConfig?.locked && (
                <div className="flex items-center gap-2 pt-1 border-t border-gray-100 dark:border-gray-900">
                  <button onClick={handleSaveLadder} disabled={ladderBusy || ladderDraft.length === 0}
                    className="text-xs font-medium px-3.5 py-2 rounded-xl border border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 disabled:opacity-40 mt-2">
                    Save
                  </button>
                  <button onClick={handleLockLadder} disabled={ladderBusy || ladderDraft.length === 0}
                    className="text-xs font-medium px-3.5 py-2 rounded-xl bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900 disabled:opacity-40 mt-2">
                    {ladderBusy ? 'Working…' : 'Lock'}
                  </button>
                </div>
              )}
            </div>

            {/* Per-domain topic counts */}
            <div className="border border-gray-200 dark:border-gray-800 rounded-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800">
                <h2 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">Unique Topic Outlines</h2>
              </div>
              {DOMAINS.map(d => {
                const config = domainConfigs[d]
                return (
                  <div key={d} className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 dark:border-gray-900 last:border-b-0">
                    <span className="text-sm text-gray-700 dark:text-gray-300 capitalize">{d}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-sm text-gray-500 dark:text-gray-400">
                        {config ? `${config.topicCount}${config.locked ? ' · locked' : ' · draft'}` : 'not set'}
                      </span>
                      <Link href="/admin/a2h/topics" className="text-xs text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 underline">Edit</Link>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Live calculation */}
            <div className="border border-gray-200 dark:border-gray-800 rounded-2xl p-4">
              <h2 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-3">Experiment Size</h2>
              <dl className="space-y-1.5 text-sm">
                <Row label="Domains" value={DOMAINS.length} />
                <Row label="Unique topics (total)" value={totalTopics} />
                <Row label="Lengths" value={activeLadder.length} />
                <Row label="Source documents" value={totalSources} emphasized />
                <Row label="Intensity levels" value={INTENSITY_COUNT} />
                <Row label="Humanite outputs" value={totalOutputs} emphasized />
                <Row label="GPTZero baseline calls" value={totalSources} />
                <Row label="GPTZero post-transform calls" value={totalOutputs} />
                <Row label="Total GPTZero analyses" value={totalGptZero} emphasized />
              </dl>
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

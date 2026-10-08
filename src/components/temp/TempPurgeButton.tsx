'use client'
// TEMPORARY: see src/lib/temp-purge/purge.ts. Remove with the API route.
import { useState } from 'react'

const COLLECTIONS_HINT = 'leftover benchmark data'

export function TempPurgeButton() {
  const [log, setLog] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  async function call(payload: Record<string, unknown>) {
    const res = await fetch('/api/temp-purge', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (!res.ok) throw new Error(String(data['error'] ?? res.status))
    return data
  }

  async function run() {
    setBusy(true)
    setLog([])
    try {
      const { counts } = (await call({ action: 'count' })) as { counts: Record<string, number> }
      const total = Object.values(counts).reduce((a, b) => a + b, 0)
      const lines = Object.entries(counts).map(([k, v]) => `${k}: ${v}`)
      setLog([`Found ${total} documents of ${COLLECTIONS_HINT}:`, ...lines])
      if (total === 0) return
      for (const name of Object.keys(counts)) {
        const r = (await call({ action: 'delete', collection: name })) as { remaining: number }
        setLog((l) => [...l, `deleted ${name} (remaining: ${r.remaining})`])
      }
      setLog((l) => [...l, 'Done.'])
    } catch (e) {
      setLog((l) => [...l, `Stopped: ${e instanceof Error ? e.message : String(e)}`])
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto my-6 max-w-xl rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900">
      <p className="mb-2 font-medium">Temporary admin tool</p>
      <button onClick={run} disabled={busy} className="rounded bg-red-600 px-3 py-1.5 text-white disabled:opacity-50">
        {busy ? 'Working…' : 'Clear leftover benchmark data from Firestore'}
      </button>
      {log.length > 0 && <pre className="mt-3 whitespace-pre-wrap text-xs">{log.join('\n')}</pre>}
    </div>
  )
}

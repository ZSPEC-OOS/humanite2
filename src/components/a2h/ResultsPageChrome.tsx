'use client'

// Small shared visual pieces for the A2H-04/05/09/10/13 results pages —
// factored out of the original A2H-01 results page (which stays
// self-contained since it predates this phase) so the five new pages don't
// each re-implement the same card/section/breakdown-bar chrome.

export function pct(n: number | null): string {
  return n == null ? '—' : `${(n * 100).toFixed(1)}%`
}

export function num(n: number | null, digits = 0): string {
  return n == null ? '—' : n.toFixed(digits)
}

export function Card({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="border border-gray-200 dark:border-gray-800 rounded-2xl p-4">
      <p className="text-xs text-gray-400 dark:text-gray-500 uppercase tracking-wider">{label}</p>
      <p className="text-xl font-semibold text-gray-900 dark:text-gray-100 tabular-nums mt-1">{value}</p>
      {sub && <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{sub}</p>}
    </div>
  )
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-gray-200 dark:border-gray-800 rounded-2xl p-4 space-y-2">
      <h2 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">{title}</h2>
      {children}
    </div>
  )
}

export interface BreakdownRow {
  key: string
  rate: number | null
  n: number
}

export function RateBreakdownTable({ rows }: { rows: BreakdownRow[] }) {
  if (rows.length === 0) return <p className="text-xs text-gray-400 dark:text-gray-500">No data yet.</p>
  const maxRate = Math.max(...rows.map(r => r.rate ?? 0), 0.01)
  return (
    <div className="space-y-1.5">
      {rows.map(r => (
        <div key={r.key} className="flex items-center gap-3 text-xs">
          <span className="w-24 shrink-0 text-gray-600 dark:text-gray-400">{r.key}</span>
          <div className="flex-1 h-4 bg-gray-100 dark:bg-gray-800 rounded overflow-hidden">
            <div className="h-full bg-blue-500 dark:bg-blue-600" style={{ width: `${((r.rate ?? 0) / maxRate) * 100}%` }} />
          </div>
          <span className="w-16 text-right tabular-nums text-gray-700 dark:text-gray-300">{pct(r.rate)}</span>
          <span className="w-14 text-right tabular-nums text-gray-400 dark:text-gray-500">n={r.n}</span>
        </div>
      ))}
    </div>
  )
}

'use client'
import type { PreservationByType } from '@/lib/api'
import type { FactLockType } from '@/lib/preprocess'

interface Props {
  open: boolean
  onClose: () => void
  data: PreservationByType
}

// Display order/labels for spec §52's "QUALITY CHECK" panel — the more
// concrete, higher-confidence categories (numbers, dates, citations) lead;
// the noisier heuristic ones (proper nouns) trail.
const CATEGORY_LABELS: Record<FactLockType, string> = {
  number: 'Numbers',
  date: 'Dates',
  citation: 'Citations',
  quotation: 'Quotes',
  url: 'URLs',
  equation: 'Equations',
  chemical: 'Chemical formulas',
  proper_noun: 'Proper nouns',
}

const CATEGORY_ORDER: FactLockType[] = [
  'number', 'date', 'citation', 'quotation', 'url', 'equation', 'chemical', 'proper_noun',
]

export function PreservationReport({ open, onClose, data }: Props) {
  if (!open) return null

  const rows = CATEGORY_ORDER
    .map(type => ({ type, cat: data[type] }))
    .filter((r): r is { type: FactLockType; cat: NonNullable<typeof r.cat> } => !!r.cat && r.cat.total > 0)

  const totalFacts = rows.reduce((sum, r) => sum + r.cat.total, 0)
  const totalPreserved = rows.reduce((sum, r) => sum + r.cat.preserved, 0)
  const overallPct = totalFacts === 0 ? null : Math.round((totalPreserved / totalFacts) * 100)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 dark:bg-black/60" onClick={onClose} />

      <div className="relative w-full max-w-md max-h-[85vh] rounded-2xl flex flex-col overflow-hidden
                       bg-white border border-gray-200 shadow-xl
                       dark:bg-gray-900 dark:border-gray-700">
        {/* header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-800 shrink-0">
          <div className="flex items-center gap-2.5">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden className="text-gray-700 dark:text-gray-300">
              <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.4" />
              <path d="M6.5 10l2.5 2.5 5-5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
            <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">What we preserved</span>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-full
                       bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors
                       dark:bg-gray-800 dark:text-gray-500 dark:hover:text-gray-300"
          >
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden>
              <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* body */}
        <div className="px-5 py-5 space-y-4 overflow-y-auto">
          <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
            Every number, date, citation, and other fact-like detail found in your original text
            is locked and checked against the rewrite. This shows what survived verbatim.
          </p>

          {rows.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-gray-500 italic py-4 text-center">
              No fact-locked spans were found in this text.
            </p>
          ) : (
            <>
              {overallPct != null && (
                <div className="flex items-center justify-between rounded-xl border p-3.5
                                bg-gray-50 border-gray-200 dark:bg-gray-800 dark:border-gray-700">
                  <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">Overall</span>
                  <span className="text-sm font-bold text-gray-900 dark:text-gray-100">
                    {overallPct}% ({totalPreserved}/{totalFacts})
                  </span>
                </div>
              )}

              <div className="space-y-2.5">
                {rows.map(({ type, cat }) => {
                  const pct = Math.round((cat.preserved / cat.total) * 100)
                  const isFull = cat.preserved === cat.total
                  return (
                    <div key={type} className="space-y-1">
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-gray-500 dark:text-gray-400 w-32 shrink-0">
                          {CATEGORY_LABELS[type]}
                        </span>
                        <div className="flex-1 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${isFull ? 'bg-gray-900 dark:bg-gray-100' : 'bg-gray-500 dark:bg-gray-400'}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-xs font-medium text-gray-700 dark:text-gray-300 w-16 text-right tabular-nums">
                          {pct}% ({cat.preserved}/{cat.total})
                        </span>
                      </div>
                      {cat.missing.length > 0 && (
                        <p className="text-xs text-gray-400 dark:text-gray-500 pl-[8.75rem]">
                          Dropped: {cat.missing.map(m => `"${m}"`).join(', ')}
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

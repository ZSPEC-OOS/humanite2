'use client'
import { useEffect, useState } from 'react'
import { apiListTransformations, apiGetTransformation, TransformationSummary, APIError } from '@/lib/api'
import { useHumanizeStore } from '@/stores/humanizeStore'
import { useEditorStore } from '@/stores/editorStore'
import { Spinner } from '@/components/ui/Spinner'

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const min = Math.floor(diffMs / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day}d ago`
  return new Date(iso).toLocaleDateString()
}

interface RecentTransformationsProps {
  // Called once a past transformation has been loaded into the editor/output
  // — the parent (desktop sidebar / mobile drawer) decides what "closing"
  // means for its own layout (this component has no opinion on that).
  onSelect?: () => void
}

export function RecentTransformations({ onSelect }: RecentTransformationsProps) {
  const [items, setItems]     = useState<TransformationSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [openingId, setOpeningId] = useState<string | null>(null)
  const hStatus = useHumanizeStore(s => s.status)
  const { setText } = useEditorStore()
  const { loadFromHistory } = useHumanizeStore()

  const refresh = () => {
    setLoading(true)
    apiListTransformations()
      .then(list => { setItems(list); setError(null) })
      .catch(e => setError(e instanceof APIError ? e.message : 'Failed to load history.'))
      .finally(() => setLoading(false))
  }

  useEffect(refresh, [])
  // A humanize run that just finished is saved server-side before the
  // client sees "done" (see saveTransformation in the humanize route) — safe
  // to refetch as soon as that status flips.
  useEffect(() => { if (hStatus === 'done') refresh() }, [hStatus])

  const handleOpen = async (id: string) => {
    setOpeningId(id)
    try {
      const detail = await apiGetTransformation(id)
      setText(detail.input_text)
      loadFromHistory(detail.output)
      onSelect?.()
    } catch {
      setError('Failed to load that transformation.')
    } finally {
      setOpeningId(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Spinner className="w-5 h-5 border-gray-200 border-t-gray-600 dark:border-gray-700 dark:border-t-gray-400" />
      </div>
    )
  }

  if (error) {
    return <p className="text-xs text-gray-400 dark:text-gray-500 px-1">{error}</p>
  }

  if (items.length === 0) {
    return <p className="text-xs text-gray-400 dark:text-gray-500 px-1">No transformations yet — humanize some text to see it here.</p>
  }

  return (
    <div className="space-y-1.5">
      {items.map(item => (
        <button
          key={item.id}
          onClick={() => handleOpen(item.id)}
          disabled={openingId !== null}
          className="w-full text-left px-3 py-2.5 rounded-xl border border-gray-200 bg-gray-50
                     hover:bg-gray-100 hover:border-gray-300 transition-colors disabled:opacity-50
                     dark:bg-gray-800 dark:border-gray-700 dark:hover:bg-gray-700 dark:hover:border-gray-600"
        >
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="text-[11px] text-gray-400 dark:text-gray-500">{timeAgo(item.created_at)}</span>
            <span className="flex items-center gap-1.5 text-[11px] text-gray-400 dark:text-gray-500 shrink-0">
              {openingId === item.id && <Spinner className="w-3 h-3 border-gray-200 border-t-gray-600 dark:border-gray-700 dark:border-t-gray-400" />}
              {item.word_count} words
            </span>
          </div>
          <p className="text-sm text-gray-700 dark:text-gray-300 line-clamp-2 leading-snug">
            {item.output_preview || item.input_preview}
          </p>
        </button>
      ))}
    </div>
  )
}

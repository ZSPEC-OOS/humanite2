'use client'
import { useState } from 'react'
import type { DetectionSegment } from '@/lib/api'

type SegmentClass = 'ai-generated' | 'human-written' | 'uncertain'
type LocatedSegment = DetectionSegment & { start_char: number; end_char: number }

const SEGMENT_STYLE: Record<SegmentClass, string> = {
  'ai-generated': 'bg-gray-300 hover:bg-gray-400 dark:bg-gray-600 dark:hover:bg-gray-500',
  'human-written': 'bg-transparent hover:bg-gray-100 dark:hover:bg-gray-800',
  uncertain: 'bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700',
}

const LABEL: Record<SegmentClass, string> = {
  'ai-generated': 'AI-like',
  'human-written': 'Human-like',
  uncertain: 'Uncertain / not analyzed',
}

// GPTZero reports a classification directly on most segments; when it
// doesn't, fall back to its own highlight recommendation before giving up
// to 'uncertain'.
function classify(seg: DetectionSegment): SegmentClass {
  if (seg.classification) return seg.classification
  return seg.highlighted_for_ai ? 'ai-generated' : 'uncertain'
}

interface SegmentHeatmapProps {
  text: string
  segments: DetectionSegment[]
}

// Segment-granularity highlighting only — spec §45 explicitly warns against
// coloring individual words as if they themselves prove authorship. Unlike
// the old scanner's smoothed windows, GPTZero's per-sentence segments
// aren't guaranteed to tile the whole document — a sentence that couldn't
// be located in the original text (start_char/end_char undefined) is
// simply skipped, and the surrounding text still renders as plain content
// rather than the whole map disappearing.
export function SegmentHeatmap({ text, segments }: SegmentHeatmapProps) {
  const [activeId, setActiveId] = useState<string | null>(null)

  const located = segments
    .filter((s): s is LocatedSegment => s.start_char != null && s.end_char != null)
    .sort((a, b) => a.start_char - b.start_char)

  if (!located.length) return null

  const active = located.find(s => s.id === activeId) ?? null

  const pieces: React.ReactNode[] = []
  let cursor = 0
  located.forEach((seg, i) => {
    if (seg.start_char > cursor) {
      pieces.push(<span key={`gap-${i}`}>{text.slice(cursor, seg.start_char)}</span>)
    }
    const cls = classify(seg)
    pieces.push(
      <span
        key={seg.id}
        onClick={() => setActiveId(current => (current === seg.id ? null : seg.id))}
        title={`${LABEL[cls]} — click for detail`}
        className={`cursor-pointer rounded-sm transition-colors ${SEGMENT_STYLE[cls]} ${
          activeId === seg.id ? 'ring-2 ring-gray-400 dark:ring-gray-500' : ''
        }`}
      >
        {text.slice(seg.start_char, seg.end_char)}
      </span>,
    )
    cursor = Math.max(cursor, seg.end_char)
  })
  if (cursor < text.length) {
    pieces.push(<span key="gap-end">{text.slice(cursor)}</span>)
  }

  return (
    <div>
      <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">
        Document Map
      </p>
      <div className="rounded-xl border border-gray-200 bg-white p-3 text-sm leading-relaxed
                      whitespace-pre-wrap max-h-64 overflow-y-auto
                      dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200">
        {pieces}
      </div>

      <div className="flex gap-3 mt-2 text-xs text-gray-400 dark:text-gray-500">
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-sm bg-gray-300 dark:bg-gray-600" /> AI-like
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-sm border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900" /> Human-like
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-sm bg-gray-100 dark:bg-gray-800" /> Uncertain / not analyzed
        </span>
      </div>

      {active && (
        <div className="mt-2 bg-gray-50 border border-gray-200 rounded-xl p-3 space-y-1 text-xs dark:bg-gray-800 dark:border-gray-700">
          <p className="font-medium text-gray-700 dark:text-gray-300">{LABEL[classify(active)]}</p>
          {active.ai_score != null && (
            <p className="text-gray-500 dark:text-gray-400">AI score: {(active.ai_score * 100).toFixed(0)}%</p>
          )}
        </div>
      )}
    </div>
  )
}

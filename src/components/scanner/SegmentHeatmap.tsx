'use client'
import { useState } from 'react'
import type { DetectionSegment } from '@/lib/api'

interface SegmentHeatmapProps {
  text: string
  segments: DetectionSegment[]
}

const SEGMENT_STYLE: Record<DetectionSegment['classification'], string> = {
  'ai-generated': 'bg-gray-300 hover:bg-gray-400 dark:bg-gray-600 dark:hover:bg-gray-500',
  'human-written': 'bg-transparent hover:bg-gray-100 dark:hover:bg-gray-800',
  uncertain: 'bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700',
}

const LABEL: Record<DetectionSegment['classification'], string> = {
  'ai-generated': 'AI-like',
  'human-written': 'Human-like',
  uncertain: 'Uncertain / not analyzed',
}

// Segment-granularity highlighting only — spec §45 explicitly warns against
// coloring individual words as if they themselves prove authorship. Each
// segment here is already a smoothed, minimum-length region (see
// aggregation.document.build_segments), not a raw inference window.
export function SegmentHeatmap({ text, segments }: SegmentHeatmapProps) {
  const [activeId, setActiveId] = useState<string | null>(null)

  if (!segments.length) return null

  const sorted = [...segments].sort((a, b) => a.start_char - b.start_char)
  const active = sorted.find(s => s.id === activeId) ?? null

  return (
    <div>
      <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">
        Document Map
      </p>
      <div className="rounded-xl border border-gray-200 bg-white p-3 text-sm leading-relaxed
                      whitespace-pre-wrap max-h-64 overflow-y-auto
                      dark:border-gray-800 dark:bg-gray-900 dark:text-gray-200">
        {sorted.map(seg => (
          <span
            key={seg.id}
            onClick={() => setActiveId(current => (current === seg.id ? null : seg.id))}
            title={`${LABEL[seg.classification]} — click for detail`}
            className={`cursor-pointer rounded-sm transition-colors ${SEGMENT_STYLE[seg.classification]} ${
              activeId === seg.id ? 'ring-2 ring-gray-400 dark:ring-gray-500' : ''
            }`}
          >
            {text.slice(seg.start_char, seg.end_char)}
          </span>
        ))}
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
          <p className="font-medium text-gray-700 dark:text-gray-300">{LABEL[active.classification]}</p>
          <p className="text-gray-500 dark:text-gray-400">AI probability: {(active.ai_probability * 100).toFixed(0)}%</p>
          <p className="text-gray-500 dark:text-gray-400">Segment confidence: {(active.confidence * 100).toFixed(0)}%</p>
        </div>
      )}
    </div>
  )
}

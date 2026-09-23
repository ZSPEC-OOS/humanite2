'use client'
import { useScanStore } from '@/stores/scanStore'
import { SegmentHeatmap } from './SegmentHeatmap'
import { Spinner } from '@/components/ui/Spinner'
import type { LocalDiagnostics } from '@/lib/api'

interface ScanReportProps {
  // The exact text that was scanned — required to render the segment
  // heatmap, since segment char offsets are into that text, not whatever
  // is currently in the editor. Optional so existing callers keep working;
  // the heatmap simply doesn't render without it.
  text?: string
}

// Terminology contract: report inference, not proof — "AI-like" /
// "Human-like", never "Detected" / "Undetectable" (which implies an
// evasion guarantee the detector cannot back up).
const CLASS_CONFIG = {
  'human-written': {
    bg: 'bg-white dark:bg-gray-900', border: 'border-gray-200 dark:border-gray-800',
    badge: 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900',
    bar: 'bg-gray-900 dark:bg-gray-100', label: 'Human-like', icon: '✓',
  },
  'ai-generated': {
    bg: 'bg-gray-50 dark:bg-gray-800', border: 'border-gray-300 dark:border-gray-700',
    badge: 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900',
    bar: 'bg-gray-900 dark:bg-gray-100', label: 'AI-like', icon: '⚠',
  },
  mixed: {
    bg: 'bg-gray-50 dark:bg-gray-800', border: 'border-gray-200 dark:border-gray-700',
    badge: 'bg-gray-700 text-white dark:bg-gray-300 dark:text-gray-900',
    bar: 'bg-gray-700 dark:bg-gray-300', label: 'Mixed', icon: '◑',
  },
  uncertain: {
    bg: 'bg-gray-50 dark:bg-gray-800', border: 'border-gray-200 dark:border-gray-700',
    badge: 'bg-gray-100 text-gray-600 border border-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:border-gray-600',
    bar: 'bg-gray-400 dark:bg-gray-500', label: 'Uncertain', icon: '?',
  },
} as const

const CONFIDENCE_LABEL: Record<string, string> = {
  high: 'High', medium: 'Medium', low: 'Low', unknown: 'Unknown',
}

function providerLabel(id: string): string {
  if (id === 'gptzero') return 'GPTZero'
  if (id === 'mock') return 'a mock provider (development)'
  return id
}

function level(value: number, lowMax: number, medMax: number): string {
  if (value < lowMax) return 'Low'
  if (value < medMax) return 'Moderate'
  return 'High'
}

function DiagnosticPanel({ diagnostics: d }: { diagnostics: LocalDiagnostics }) {
  const rows = [
    { label: 'Sentence variation', value: level(d.sentence_length_stddev, 3, 7) },
    { label: 'Lexical diversity', value: level(d.lexical_diversity, 0.4, 0.6) },
    { label: 'Phrase repetition', value: level(d.repeated_bigram_rate, 0.05, 0.15) },
    { label: 'Contraction use', value: level(d.contraction_rate, 0.01, 0.05) },
    { label: 'First-person voice', value: level(d.first_person_rate, 0.02, 0.08) },
    { label: 'Question use', value: level(d.question_rate, 0.05, 0.2) },
  ]

  return (
    <div>
      <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2.5">
        Writing Characteristics
      </p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        {rows.map(r => (
          <div key={r.label} className="flex items-center justify-between text-xs">
            <span className="text-gray-500 dark:text-gray-400">{r.label}</span>
            <span className="font-medium text-gray-700 dark:text-gray-300">{r.value}</span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">
        {d.word_count.toLocaleString()} words · {d.sentence_count.toLocaleString()} sentences
        {d.readability_score != null && ` · Flesch readability ${d.readability_score.toFixed(0)}`}
      </p>
    </div>
  )
}

export function ScanReport({ text }: ScanReportProps = {}) {
  const { response, status, error } = useScanStore()

  if (status === 'idle') {
    return (
      <div className="h-full flex items-center justify-center p-6 text-sm text-gray-400 dark:text-gray-500 italic">
        Run a scan to see results.
      </div>
    )
  }

  if (status === 'loading') {
    return (
      <div className="h-full flex items-center justify-center p-6">
        <div className="text-center">
          <Spinner className="w-8 h-8 border-gray-200 border-t-gray-700 dark:border-gray-700 dark:border-t-gray-300 block mx-auto mb-3" />
          <p className="text-sm text-gray-500 dark:text-gray-400">Analyzing…</p>
        </div>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="p-4 m-3 text-sm font-medium text-gray-900 bg-gray-50
                      border border-gray-200 rounded-xl
                      dark:text-gray-100 dark:bg-gray-800 dark:border-gray-700">
        {error}
      </div>
    )
  }

  if (!response) return null

  const cfg = CLASS_CONFIG[response.classification] ?? CLASS_CONFIG.uncertain
  const { human, ai, mixed } = response.probabilities
  const predicted = response.predicted_class_probability

  return (
    <div className="p-4 space-y-4 overflow-y-auto h-full">

      {/* Classification banner */}
      <div className={`rounded-xl border p-4 ${cfg.bg} ${cfg.border}`}>
        <div className="flex items-center justify-between mb-3">
          <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${cfg.badge}`}>
            {cfg.icon} {cfg.label.toUpperCase()}
          </span>
          <div className="text-right">
            <span className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              {predicted != null ? `${(predicted * 100).toFixed(0)}%` : '—'}
            </span>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {cfg.label.toLowerCase()} probability
            </p>
          </div>
        </div>
        {predicted != null && (
          <div className="h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-all ${cfg.bar}`}
                 style={{ width: `${predicted * 100}%` }} />
          </div>
        )}
        <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
          Confidence: <span className="font-medium text-gray-700 dark:text-gray-300">
            {CONFIDENCE_LABEL[response.confidence_category] ?? response.confidence_category}
          </span>
        </p>
      </div>

      {/* Provider warnings — e.g. a low-confidence or unrecognized result */}
      {response.warnings.length > 0 && (
        <div className="text-xs text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800
                        border border-gray-200 dark:border-gray-700 rounded-xl p-3 space-y-1">
          {response.warnings.map((w, i) => <p key={i}>⚠ {w}</p>)}
        </div>
      )}

      {/* Estimated AI-like content — a share-of-document estimate, distinct
          from the confidence above in how sure the detector is about the
          overall verdict (spec §11); left out entirely when the response
          isn't granular enough to justify one. */}
      {response.estimated_ai_like_fraction != null && (
        <p className="text-xs text-gray-400 dark:text-gray-500">
          Estimated AI-like content: {(response.estimated_ai_like_fraction * 100).toFixed(0)}%
        </p>
      )}

      {/* Document map — segment heatmap over the exact scanned text */}
      {text && response.segments.length > 0 && (
        <SegmentHeatmap text={text} segments={response.segments} />
      )}

      {/* Class probabilities */}
      <div className="space-y-2.5">
        <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
          Class Probabilities
        </p>
        {[
          { label: 'Human', value: human, color: 'bg-gray-900 dark:bg-gray-100' },
          { label: 'AI', value: ai, color: 'bg-gray-700 dark:bg-gray-300' },
          { label: 'Mixed', value: mixed, color: 'bg-gray-400 dark:bg-gray-500' },
        ].map(({ label, value, color }) => (
          <div key={label} className="flex items-center gap-3">
            <span className="text-xs text-gray-500 dark:text-gray-400 w-10">{label}</span>
            <div className="flex-1 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all ${color}`}
                   style={{ width: `${(value ?? 0) * 100}%` }} />
            </div>
            <span className="text-xs font-medium text-gray-700 dark:text-gray-300 w-9 text-right tabular-nums">
              {value != null ? `${(value * 100).toFixed(0)}%` : '—'}
            </span>
          </div>
        ))}
      </div>

      {/* Writing diagnostics — descriptive only, never a second opinion */}
      {response.diagnostics && <DiagnosticPanel diagnostics={response.diagnostics} />}

      {/* Explanation */}
      {response.explanation && (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-3.5 space-y-1.5 dark:bg-gray-800 dark:border-gray-700">
          <p className="text-xs font-medium text-gray-700 dark:text-gray-300">
            {response.explanation.summary}
          </p>
          {response.explanation.detail && (
            <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
              {response.explanation.detail}
            </p>
          )}
        </div>
      )}

      {/* Provider attribution + timing */}
      <p className="text-xs text-gray-400 dark:text-gray-500">
        Detection provided by {providerLabel(response.provider.id)}
        {response.processing_duration_ms != null ? ` · ${response.processing_duration_ms}ms` : ''}
      </p>
    </div>
  )
}

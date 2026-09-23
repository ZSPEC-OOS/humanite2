'use client'
import { useScanStore } from '@/stores/scanStore'
import { PerplexityChart } from './PerplexityChart'
import { Spinner } from '@/components/ui/Spinner'

// Terminology contract: report inference, not proof — "AI-like" /
// "Human-like", never "Detected" / "Undetectable" (which implies an
// evasion guarantee the detector cannot back up).
const CLASS_CONFIG = {
  'human-written': {
    bg: 'bg-green-50', border: 'border-green-200',
    badge: 'bg-green-100 text-green-700 border border-green-300',
    bar: 'bg-green-500', label: 'Human-like', icon: '✓',
  },
  'ai-generated': {
    bg: 'bg-red-50', border: 'border-red-200',
    badge: 'bg-red-100 text-red-700 border border-red-300',
    bar: 'bg-red-500', label: 'AI-like', icon: '⚠',
  },
  mixed: {
    bg: 'bg-amber-50', border: 'border-amber-200',
    badge: 'bg-amber-100 text-amber-700 border border-amber-300',
    bar: 'bg-amber-500', label: 'Mixed', icon: '◑',
  },
  uncertain: {
    bg: 'bg-gray-50', border: 'border-gray-200',
    badge: 'bg-gray-100 text-gray-600 border border-gray-300',
    bar: 'bg-gray-400', label: 'Uncertain', icon: '?',
  },
} as const

type ClassKey = keyof typeof CLASS_CONFIG

export function ScanReport() {
  const { response, status, error } = useScanStore()

  if (status === 'idle') {
    return (
      <div className="h-full flex items-center justify-center p-6 text-sm text-gray-400 italic">
        Run a scan to see results.
      </div>
    )
  }

  if (status === 'loading') {
    return (
      <div className="h-full flex items-center justify-center p-6">
        <div className="text-center">
          <Spinner className="w-8 h-8 border-gray-200 border-t-gray-700 block mx-auto mb-3" />
          <p className="text-sm text-gray-500">Analyzing…</p>
        </div>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="p-4 m-3 text-sm text-red-600 bg-red-50
                      border border-red-200 rounded-xl">
        {error}
      </div>
    )
  }

  if (!response || !response.classification) return null

  const cls    = (response.classification as ClassKey) ?? 'uncertain'
  const cfg    = CLASS_CONFIG[cls] ?? CLASS_CONFIG.uncertain
  const conf   = response.confidence ?? 0
  const hProb  = response.human_probability ?? 0
  const aiProb = response.ai_probability   ?? 0

  return (
    <div className="p-4 space-y-4 overflow-y-auto h-full">

      {/* Classification banner */}
      <div className={`rounded-xl border p-4 ${cfg.bg} ${cfg.border}`}>
        <div className="flex items-center justify-between mb-3">
          <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${cfg.badge}`}>
            {cfg.icon} {cfg.label.toUpperCase()}
          </span>
          <div className="text-right">
            <span className="text-2xl font-bold text-gray-900">
              {(conf * 100).toFixed(0)}%
            </span>
            <p className="text-xs text-gray-500">confidence</p>
          </div>
        </div>
        <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
          <div className={`h-full rounded-full transition-all ${cfg.bar}`}
               style={{ width: `${conf * 100}%` }} />
        </div>
      </div>

      {/* Probability breakdown */}
      <div className="space-y-2.5">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
          Probability Breakdown
        </p>
        {[
          { label: 'Human', value: hProb,  color: 'bg-green-500' },
          { label: 'AI',    value: aiProb, color: 'bg-red-500' },
        ].map(({ label, value, color }) => (
          <div key={label} className="flex items-center gap-3">
            <span className="text-xs text-gray-500 w-10">{label}</span>
            <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all ${color}`}
                   style={{ width: `${value * 100}%` }} />
            </div>
            <span className="text-xs font-medium text-gray-700 w-9 text-right tabular-nums">
              {(value * 100).toFixed(0)}%
            </span>
          </div>
        ))}
      </div>

      {/* Perplexity chart */}
      {response.per_sentence_perplexity.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
            Per-Sentence Perplexity
          </p>
          <PerplexityChart scores={response.per_sentence_perplexity} />
        </div>
      )}

      {/* Top features */}
      {response.top_features.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2.5">
            Top Signals
          </p>
          <div className="space-y-2">
            {response.top_features.map((f, i) => (
              <div key={i} className="flex items-center gap-2.5">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  f.direction === 'ai_indicator' ? 'bg-red-500' : 'bg-green-500'
                }`} />
                <span className="text-xs text-gray-500 flex-1 truncate">
                  {f.feature.replace(/_/g, ' ')}
                </span>
                <div className="w-16 h-1 bg-gray-200 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${
                    f.direction === 'ai_indicator' ? 'bg-red-500' : 'bg-green-500'
                  }`} style={{ width: `${f.contribution * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Explanation */}
      {response.explanation && (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-3.5 space-y-1.5">
          <p className="text-xs font-medium text-gray-700">
            {response.explanation.summary}
          </p>
          <p className="text-xs text-gray-500 leading-relaxed">
            {response.explanation.detail}
          </p>
        </div>
      )}

      {/* Model info */}
      {response.model_used && (
        <p className="text-xs text-gray-400">
          Model: {response.model_used}
          {response.processing_duration_ms != null
            ? ` · ${response.processing_duration_ms}ms` : ''}
        </p>
      )}
    </div>
  )
}

'use client'
import { useScanStore } from '@/stores/scanStore'
import { PerplexityChart } from './PerplexityChart'
import { Spinner } from '@/components/ui/Spinner'

const CLASS_CONFIG = {
  'human-written': {
    bg: 'bg-green-500/10', border: 'border-green-500/25',
    badge: 'bg-green-500/15 text-green-400 border border-green-500/30',
    bar: 'bg-green-400', label: 'Human Written', icon: '✓',
  },
  'ai-generated': {
    bg: 'bg-red-500/10', border: 'border-red-500/25',
    badge: 'bg-red-500/15 text-red-400 border border-red-500/30',
    bar: 'bg-red-400', label: 'AI Generated', icon: '⚠',
  },
  mixed: {
    bg: 'bg-amber-500/10', border: 'border-amber-500/25',
    badge: 'bg-amber-500/15 text-amber-400 border border-amber-500/30',
    bar: 'bg-amber-400', label: 'Mixed', icon: '◑',
  },
  uncertain: {
    bg: 'bg-white/5', border: 'border-white/10',
    badge: 'bg-white/8 text-white/50 border border-white/15',
    bar: 'bg-white/30', label: 'Uncertain', icon: '?',
  },
} as const

type ClassKey = keyof typeof CLASS_CONFIG

export function ScanReport() {
  const { response, status, error } = useScanStore()

  if (status === 'idle') {
    return (
      <div className="h-full flex items-center justify-center p-6 text-sm text-white/25 italic">
        Run a scan to see results.
      </div>
    )
  }

  if (status === 'loading') {
    return (
      <div className="h-full flex items-center justify-center p-6">
        <div className="text-center">
          <Spinner className="w-8 h-8 border-brand-violet/30 border-t-brand-violet block mx-auto mb-3" />
          <p className="text-sm text-white/40">Analyzing…</p>
        </div>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="p-4 m-3 text-sm text-red-400 bg-red-500/10
                      border border-red-500/25 rounded-xl">
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
            <span className="text-2xl font-bold text-white">
              {(conf * 100).toFixed(0)}%
            </span>
            <p className="text-xs text-white/35">confidence</p>
          </div>
        </div>
        <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
          <div className={`h-full rounded-full transition-all ${cfg.bar}`}
               style={{ width: `${conf * 100}%` }} />
        </div>
      </div>

      {/* Probability breakdown */}
      <div className="space-y-2.5">
        <p className="text-xs font-semibold text-white/30 uppercase tracking-wider">
          Probability Breakdown
        </p>
        {[
          { label: 'Human', value: hProb,  color: 'bg-green-400' },
          { label: 'AI',    value: aiProb, color: 'bg-red-400' },
        ].map(({ label, value, color }) => (
          <div key={label} className="flex items-center gap-3">
            <span className="text-xs text-white/40 w-10">{label}</span>
            <div className="flex-1 h-1.5 bg-white/8 rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all ${color}`}
                   style={{ width: `${value * 100}%` }} />
            </div>
            <span className="text-xs font-medium text-white/60 w-9 text-right tabular-nums">
              {(value * 100).toFixed(0)}%
            </span>
          </div>
        ))}
      </div>

      {/* Perplexity chart */}
      {response.per_sentence_perplexity.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-white/30 uppercase tracking-wider mb-2">
            Per-Sentence Perplexity
          </p>
          <PerplexityChart scores={response.per_sentence_perplexity} />
        </div>
      )}

      {/* Top features */}
      {response.top_features.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-white/30 uppercase tracking-wider mb-2.5">
            Top Signals
          </p>
          <div className="space-y-2">
            {response.top_features.map((f, i) => (
              <div key={i} className="flex items-center gap-2.5">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                  f.direction === 'ai_indicator' ? 'bg-red-400' : 'bg-green-400'
                }`} />
                <span className="text-xs text-white/50 flex-1 truncate">
                  {f.feature.replace(/_/g, ' ')}
                </span>
                <div className="w-16 h-1 bg-white/8 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${
                    f.direction === 'ai_indicator' ? 'bg-red-400' : 'bg-green-400'
                  }`} style={{ width: `${f.contribution * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Explanation */}
      {response.explanation && (
        <div className="bg-white/5 border border-white/8 rounded-xl p-3.5 space-y-1.5">
          <p className="text-xs font-medium text-white/70">
            {response.explanation.summary}
          </p>
          <p className="text-xs text-white/40 leading-relaxed">
            {response.explanation.detail}
          </p>
        </div>
      )}

      {/* Model info */}
      {response.model_used && (
        <p className="text-xs text-white/25">
          Model: {response.model_used}
          {response.processing_duration_ms != null
            ? ` · ${response.processing_duration_ms}ms` : ''}
        </p>
      )}
    </div>
  )
}

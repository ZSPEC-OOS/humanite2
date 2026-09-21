'use client'
import { useRef, useEffect, useState } from 'react'
import { useEditorStore }   from '@/stores/editorStore'
import { useHumanizeStore } from '@/stores/humanizeStore'
import { InlineDiff }       from './InlineDiff'
import { Spinner }          from '@/components/ui/Spinner'

type ViewMode = 'split' | 'diff' | 'output'

export function SplitView({ mobileOutputOnly = false }: { mobileOutputOnly?: boolean }) {
  const { text }                    = useEditorStore()
  const { response, status, error } = useHumanizeStore()
  const [mode, setMode]             = useState<ViewMode>('split')
  const origRef                     = useRef<HTMLDivElement>(null)
  const humRef                      = useRef<HTMLDivElement>(null)
  const isSyncing                   = useRef(false)

  const output = response?.output
  const warn   = response?.warning
  const wm     = output?.watermark

  // Synchronized scroll
  useEffect(() => {
    const orig = origRef.current
    const hum  = humRef.current
    if (!orig || !hum) return
    const syncLeft = () => {
      if (isSyncing.current) return
      isSyncing.current = true
      const ratio = orig.scrollTop / (orig.scrollHeight - orig.clientHeight || 1)
      hum.scrollTop = ratio * (hum.scrollHeight - hum.clientHeight)
      isSyncing.current = false
    }
    const syncRight = () => {
      if (isSyncing.current) return
      isSyncing.current = true
      const ratio = hum.scrollTop / (hum.scrollHeight - hum.clientHeight || 1)
      orig.scrollTop = ratio * (orig.scrollHeight - orig.clientHeight)
      isSyncing.current = false
    }
    orig.addEventListener('scroll', syncLeft)
    hum.addEventListener('scroll', syncRight)
    return () => {
      orig.removeEventListener('scroll', syncLeft)
      hum.removeEventListener('scroll', syncRight)
    }
  }, [])

  if (status === 'idle') {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 rounded-full bg-white/5 border border-white/10
                          flex items-center justify-center mx-auto mb-4">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
              <path d="M10 1.5 12.8 8.2 19.5 10 12.8 11.8 10 18.5 7.2 11.8 0.5 10 7.2 8.2Z"
                fill="url(#idle-star)" opacity="0.4"/>
              <defs>
                <linearGradient id="idle-star" x1="0" y1="0" x2="20" y2="20">
                  <stop stopColor="#a78bfa"/><stop offset="1" stopColor="#f472b6"/>
                </linearGradient>
              </defs>
            </svg>
          </div>
          <p className="text-sm font-medium text-white/30">Ready to humanize</p>
          <p className="text-xs mt-1 text-white/20">Paste text above then click Humanize</p>
        </div>
      </div>
    )
  }

  if (status === 'loading') {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <Spinner className="w-10 h-10 border-brand-violet/30 border-t-brand-violet block mx-auto mb-4" />
          <p className="text-sm text-white/50">Rewriting with quality gates…</p>
          <p className="text-xs text-white/30 mt-1">Validating semantic preservation</p>
        </div>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="h-full flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-red-500/10 border border-red-500/30
                        rounded-xl p-4 text-sm text-red-400">
          <p className="font-semibold mb-1 text-red-300">Error</p>
          <p>{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-dark-base">
      {/* Tab bar */}
      <div className="flex items-center justify-between px-4 py-2
                      bg-dark-card border-b border-white/8 shrink-0">
        <div className="flex gap-1">
          {(['split', 'diff', 'output'] as ViewMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-3 py-1 text-xs rounded-lg transition-all ${
                mode === m
                  ? 'bg-brand-violet/20 text-brand-violet border border-brand-violet/40 font-semibold'
                  : 'text-white/40 hover:text-white/70 hover:bg-white/5'
              }`}
            >
              {m.charAt(0).toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>

        {output && (
          <div className="flex items-center gap-2">
            {output.quality_scores.bertscore_f1 == null ? (
              <span className="flex items-center gap-1.5 text-xs text-white/40
                               bg-white/5 border border-white/10 rounded-full px-2.5 py-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-white/30" />
                Not yet scored
              </span>
            ) : output.quality_scores.passed ? (
              <span className="flex items-center gap-1.5 text-xs text-green-400
                               bg-green-500/10 border border-green-500/25 rounded-full px-2.5 py-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
                BERTScore {output.quality_scores.bertscore_f1.toFixed(3)}
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-xs text-amber-400
                               bg-amber-500/10 border border-amber-500/25 rounded-full px-2.5 py-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                Gate not met
              </span>
            )}
          </div>
        )}
      </div>

      {/* Warning banner */}
      {warn && (
        <div className="px-4 py-2 bg-amber-500/10 border-b border-amber-500/20
                        text-xs text-amber-400 shrink-0">
          ⚠ {warn}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 min-h-0 flex">
        {mode === 'split' && (
          <>
            {/* Original — hidden on mobile (user reads it in the Input tab) */}
            <div className={`flex-1 flex flex-col border-r border-white/8 ${mobileOutputOnly ? 'hidden md:flex' : 'flex'}`}>
              <div className="flex items-center gap-2 px-4 py-2
                              bg-dark-card border-b border-white/8 shrink-0">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
                  <rect x="1" y="1" width="14" height="14" rx="3"
                    stroke="#818cf8" strokeWidth="1.3"/>
                  <path d="M4 6h8M4 9h5" stroke="#818cf8" strokeWidth="1.3" strokeLinecap="round"/>
                </svg>
                <span className="text-xs font-semibold text-white/40">Original</span>
              </div>
              <div
                ref={origRef}
                className="flex-1 overflow-y-auto p-4 text-sm leading-relaxed
                           whitespace-pre-wrap text-white/60 font-mono"
              >
                {text || <span className="text-white/20 italic">No input text</span>}
              </div>
            </div>

            {/* Humanized */}
            <div className="flex-1 flex flex-col">
              <div className="flex items-center gap-2 px-4 py-2
                              bg-brand-violet/8 border-b border-brand-violet/20 shrink-0">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
                  <circle cx="8" cy="8" r="6.5" stroke="#a855f7" strokeWidth="1.3"/>
                  <path d="M5.5 8l2 2 3-3" stroke="#a855f7" strokeWidth="1.3"
                    strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <span className="text-xs font-semibold text-brand-violet">Humanized</span>
              </div>
              <div
                ref={humRef}
                className="flex-1 overflow-y-auto p-4 text-sm leading-relaxed
                           whitespace-pre-wrap text-white/85 font-mono"
              >
                {output?.text ?? (
                  <span className="text-white/20 italic">Output will appear here</span>
                )}
              </div>
            </div>
          </>
        )}

        {mode === 'diff' && output && (
          <div className="flex-1 overflow-y-auto p-4">
            <div className="flex gap-4 text-xs text-white/40 mb-3">
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-3 rounded-sm bg-green-500/20 border border-green-500/40" />
                Added
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-3 rounded-sm bg-red-500/20 border border-red-500/40" />
                Removed
              </span>
            </div>
            <InlineDiff original={text} rewritten={output.text} />
          </div>
        )}

        {mode === 'output' && (
          <div className="flex-1 overflow-y-auto p-4 text-sm leading-relaxed
                          whitespace-pre-wrap text-white/80">
            {output?.text ?? (
              <span className="text-white/25 italic">No output yet</span>
            )}
          </div>
        )}
      </div>

      {/* Watermark footer */}
      {wm && (
        <div className="flex items-center gap-2 px-4 py-2
                        bg-dark-card border-t border-white/8 shrink-0">
          <span className="text-white/30 text-xs">🔒</span>
          <span className="text-xs text-white/30">
            AI Processed · {wm.fingerprint.slice(0, 16)}…
          </span>
          <a
            href={wm.verification_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-brand-violet hover:text-brand-violet/80 ml-auto"
          >
            Verify
          </a>
        </div>
      )}
    </div>
  )
}

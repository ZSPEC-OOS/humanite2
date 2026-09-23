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
          <div className="w-12 h-12 rounded-full bg-gray-50 border border-gray-200
                          flex items-center justify-center mx-auto mb-4
                          dark:bg-gray-800 dark:border-gray-700">
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden className="text-gray-400 dark:text-gray-500">
              <path d="M10 1.5 12.8 8.2 19.5 10 12.8 11.8 10 18.5 7.2 11.8 0.5 10 7.2 8.2Z"
                fill="currentColor"/>
            </svg>
          </div>
          <p className="text-sm font-medium text-gray-500 dark:text-gray-400">Ready to humanize</p>
          <p className="text-xs mt-1 text-gray-400 dark:text-gray-500">Paste text above then click Humanize</p>
        </div>
      </div>
    )
  }

  if (status === 'loading') {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <Spinner className="w-10 h-10 border-gray-200 border-t-gray-700 dark:border-gray-700 dark:border-t-gray-300 block mx-auto mb-4" />
          <p className="text-sm text-gray-600 dark:text-gray-400">Rewriting with quality gates…</p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Validating semantic preservation</p>
        </div>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="h-full flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-gray-50 border border-gray-200
                        rounded-xl p-4 text-sm text-gray-900
                        dark:bg-gray-800 dark:border-gray-700 dark:text-gray-100">
          <p className="font-semibold mb-1">Error</p>
          <p>{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-900">
      {/* Tab bar */}
      <div className="flex items-center justify-between px-4 py-2
                      bg-white border-b border-gray-200 shrink-0
                      dark:bg-gray-900 dark:border-gray-800">
        <div className="flex gap-1">
          {(['split', 'diff', 'output'] as ViewMode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-3 py-1 text-xs rounded-lg transition-all ${
                mode === m
                  ? 'bg-gray-900 text-white font-semibold dark:bg-gray-100 dark:text-gray-900'
                  : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-100 dark:hover:bg-gray-800'
              }`}
            >
              {m.charAt(0).toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>

        {output && (
          <div className="flex items-center gap-2">
            {output.quality_scores.semantic_similarity == null ? (
              <span className="flex items-center gap-1.5 text-xs text-gray-500
                               bg-gray-50 border border-gray-200 rounded-full px-2.5 py-0.5
                               dark:text-gray-400 dark:bg-gray-800 dark:border-gray-700">
                <span className="w-1.5 h-1.5 rounded-full bg-gray-300 dark:bg-gray-600" />
                Not yet scored
              </span>
            ) : output.quality_scores.passed ? (
              <span className="flex items-center gap-1.5 text-xs text-gray-900
                               bg-gray-100 border border-gray-300 rounded-full px-2.5 py-0.5
                               dark:text-gray-100 dark:bg-gray-800 dark:border-gray-600">
                <span className="w-1.5 h-1.5 rounded-full bg-gray-900 dark:bg-gray-100" />
                Similarity {output.quality_scores.semantic_similarity.toFixed(3)}
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-900
                               bg-gray-100 border border-gray-400 rounded-full px-2.5 py-0.5
                               dark:text-gray-100 dark:bg-gray-800 dark:border-gray-500">
                <span className="w-1.5 h-1.5 rounded-full bg-gray-600 dark:bg-gray-400" />
                Gate not met
              </span>
            )}
          </div>
        )}
      </div>

      {/* Warning banner */}
      {warn && (
        <div className="px-4 py-2 bg-gray-50 border-b border-gray-200
                        text-xs text-gray-700 shrink-0
                        dark:bg-gray-800 dark:border-gray-700 dark:text-gray-300">
          ⚠ {warn}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 min-h-0 flex">
        {mode === 'split' && (
          <>
            {/* Original — hidden on mobile (user reads it in the Input tab) */}
            <div className={`flex-1 flex flex-col border-r border-gray-200 dark:border-gray-800 ${mobileOutputOnly ? 'hidden md:flex' : 'flex'}`}>
              <div className="flex items-center gap-2 px-4 py-2
                              bg-white border-b border-gray-200 shrink-0
                              dark:bg-gray-900 dark:border-gray-800">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden className="text-gray-400 dark:text-gray-500">
                  <rect x="1" y="1" width="14" height="14" rx="3"
                    stroke="currentColor" strokeWidth="1.3"/>
                  <path d="M4 6h8M4 9h5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                </svg>
                <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">Original</span>
              </div>
              <div
                ref={origRef}
                className="flex-1 overflow-y-auto p-4 text-sm leading-relaxed
                           whitespace-pre-wrap text-gray-600 dark:text-gray-400 font-mono"
              >
                {text || <span className="text-gray-400 dark:text-gray-600 italic">No input text</span>}
              </div>
            </div>

            {/* Humanized */}
            <div className="flex-1 flex flex-col">
              <div className="flex items-center gap-2 px-4 py-2
                              bg-gray-50 border-b border-gray-200 shrink-0
                              dark:bg-gray-800 dark:border-gray-800">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden className="text-gray-700 dark:text-gray-300">
                  <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.3"/>
                  <path d="M5.5 8l2 2 3-3" stroke="currentColor" strokeWidth="1.3"
                    strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">Humanized</span>
              </div>
              <div
                ref={humRef}
                className="flex-1 overflow-y-auto p-4 text-sm leading-relaxed
                           whitespace-pre-wrap text-gray-800 dark:text-gray-200 font-mono"
              >
                {output?.text ?? (
                  <span className="text-gray-400 dark:text-gray-600 italic">Output will appear here</span>
                )}
              </div>
            </div>
          </>
        )}

        {mode === 'diff' && output && (
          <div className="flex-1 overflow-y-auto p-4">
            <div className="flex gap-4 text-xs text-gray-500 dark:text-gray-400 mb-3">
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-3 rounded-sm bg-gray-200 border border-gray-300 dark:bg-gray-700 dark:border-gray-600" />
                Added
              </span>
              <span className="flex items-center gap-1.5">
                <span className="inline-block w-3 h-3 rounded-sm bg-gray-50 border border-gray-300 dark:bg-gray-800 dark:border-gray-600" />
                Removed
              </span>
            </div>
            <InlineDiff original={text} rewritten={output.text} />
          </div>
        )}

        {mode === 'output' && (
          <div className="flex-1 overflow-y-auto p-4 text-sm leading-relaxed
                          whitespace-pre-wrap text-gray-800 dark:text-gray-200">
            {output?.text ?? (
              <span className="text-gray-400 dark:text-gray-600 italic">No output yet</span>
            )}
          </div>
        )}
      </div>

      {/* Watermark footer */}
      {wm && (
        <div className="flex items-center gap-2 px-4 py-2
                        bg-white border-t border-gray-200 shrink-0
                        dark:bg-gray-900 dark:border-gray-800">
          <span className="text-gray-400 dark:text-gray-500 text-xs">🔒</span>
          <span className="text-xs text-gray-400 dark:text-gray-500">
            AI Processed · {wm.fingerprint.slice(0, 16)}…
          </span>
          <a
            href={wm.verification_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-gray-700 hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-100 ml-auto"
          >
            Verify
          </a>
        </div>
      )}
    </div>
  )
}

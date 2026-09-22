'use client'
import { useEffect, useState } from 'react'
import Image from 'next/image'
import { useUserStore }     from '@/stores/userStore'
import { useHumanizeStore } from '@/stores/humanizeStore'
import { useScanStore }     from '@/stores/scanStore'
import { useEditorStore }   from '@/stores/editorStore'
import { useApiConfigStore } from '@/stores/apiConfigStore'
import { ControlPanel }     from '@/components/editor/ControlPanel'
import { PresetSelector }   from '@/components/editor/PresetSelector'
import { ExportMenu }       from '@/components/output/ExportMenu'
import { ScanReport }       from '@/components/scanner/ScanReport'
import { Spinner }          from '@/components/ui/Spinner'
import { ApiConfigModal }   from '@/components/settings/ApiConfigModal'
import { ASYNC_MAX_CHARS, SYNC_MAX_CHARS } from '@/lib/limits'

const MAX_CHARS = ASYNC_MAX_CHARS

function wordCount(s: string) {
  return s.trim() ? s.trim().split(/\s+/).length : 0
}

function CircularScore({ pct }: { pct: number }) {
  const r = 26, circ = 2 * Math.PI * r
  return (
    <svg width="68" height="68" viewBox="0 0 68 68" aria-hidden>
      <circle cx="34" cy="34" r={r} fill="none" stroke="#e5e7eb" strokeWidth="5" />
      <circle
        cx="34" cy="34" r={r} fill="none" stroke="#22c55e" strokeWidth="5"
        strokeDasharray={circ} strokeDashoffset={circ * (1 - pct / 100)}
        strokeLinecap="round" transform="rotate(-90 34 34)"
      />
      <text x="34" y="34" textAnchor="middle" dominantBaseline="central"
        fill="#111827" fontSize="13" fontWeight="700">{pct}%</text>
    </svg>
  )
}

type MobileTab = 'input' | 'output' | 'scan'

export default function Dashboard() {
  const { tier }                                                       = useUserStore()
  const { humanize, status: hStatus, reset: resetH, response, error, progressMessage } = useHumanizeStore()
  const { scan, status: sStatus, reset: resetS, response: scanResp }  = useScanStore()
  const { text, setText, clearText }                                   = useEditorStore()
  const { hasCustomConfig, config: apiConfig }                         = useApiConfigStore()
  const [mobileTab, setMobileTab]     = useState<MobileTab>('input')
  const [menuOpen, setMenuOpen]       = useState(false)
  const [copied, setCopied]           = useState(false)
  const [apiConfigOpen, setApiConfigOpen] = useState(false)

  useEffect(() => { if (hStatus === 'done') setMobileTab('output') }, [hStatus])
  useEffect(() => { if (sStatus === 'done') setMobileTab('scan')   }, [sStatus])

  const output     = response?.output
  const outputText = output?.text ?? ''
  const canSubmit  = text.trim().length >= 20
  const hLoading   = hStatus === 'loading'
  const sLoading   = sStatus === 'loading'
  const showScan   = sStatus !== 'idle'

  const handleClear = () => { clearText(); resetH(); resetS(); setMobileTab('input') }
  const handleCopy  = () => {
    if (!outputText) return
    navigator.clipboard.writeText(outputText).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2000)
    })
  }

  // bertscore_f1 is null until the semantic-fidelity gate (Phase 1) is wired in —
  // never fabricate a score in its place.
  const humanScore = output && output.quality_scores.bertscore_f1 != null
    ? Math.round(output.quality_scores.bertscore_f1 * 100)
    : null
  const scoreLabel = humanScore == null ? 'Not yet scored'
    : humanScore >= 90 ? 'Excellent' : humanScore >= 75 ? 'Good' : 'Fair'
  const aiDetLabel = scanResp?.classification === 'human-written' ? 'Undetectable'
                   : scanResp?.classification === 'ai-generated'  ? 'Detected'
                   : scanResp?.classification === 'mixed'         ? 'Partial'
                   : null

  /* ── Shared panel JSX ── */
  const inputPanel = (
    <div className="bg-white border border-gray-200 rounded-2xl flex flex-col h-full min-h-[260px]">
      <div className="flex items-center gap-2 px-4 pt-4 pb-3 border-b border-gray-200 shrink-0">
        <svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden>
          <rect x="2" y="2" width="16" height="16" rx="4" stroke="#9ca3af" strokeWidth="1.4" />
          <path d="M5 7h10M5 10.5h7M5 14h5" stroke="#9ca3af" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
        <span className="text-sm font-semibold text-gray-500">AI-Generated Text</span>
      </div>
      <textarea
        value={text}
        onChange={e => setText(e.target.value.slice(0, MAX_CHARS))}
        placeholder="Paste your AI-generated text here…"
        className="flex-1 bg-transparent resize-none text-sm text-gray-800 leading-relaxed
                   px-4 py-3 outline-none placeholder-gray-400 font-sans"
      />
      <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 shrink-0">
        <span className="text-xs text-gray-400">
          {wordCount(text)} Words
          {text.length > SYNC_MAX_CHARS && ' · processed in the background'}
        </span>
        <button onClick={handleClear} title="Clear"
          className="text-gray-300 hover:text-gray-600 transition-colors">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M2 14l12-12M14 14L2 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  )

  const outputPanel = (
    <div className="bg-white border border-gray-200 rounded-2xl flex flex-col h-full min-h-[260px]">
      <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-gray-200 shrink-0">
        <div className="flex items-center gap-2">
          <svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden>
            <circle cx="10" cy="10" r="7.5" stroke="#374151" strokeWidth="1.4" />
            <path d="M7 10l2 2 4-4" stroke="#374151" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="text-sm font-semibold text-gray-500">Humanized Text</span>
        </div>
        {output?.quality_scores.passed && (
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none" className="text-green-500">
            <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.4" />
            <path d="M6.5 10l2.5 2.5 5-5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>
      {response?.warning && hStatus === 'done' && (
        <div className="px-4 py-2 bg-amber-50 border-b border-amber-200 text-xs text-amber-700 shrink-0">
          ⚠ {response.warning}
        </div>
      )}
      <div className="flex-1 overflow-y-auto px-4 py-3 text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">
        {hLoading ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-center px-6">
              <Spinner className="w-8 h-8 border-gray-200 border-t-gray-700 block mx-auto mb-3" />
              <p className="text-xs text-gray-500">{progressMessage ?? 'Rewriting…'}</p>
            </div>
          </div>
        ) : hStatus === 'error' ? (
          <p className="text-sm text-red-500">{error ?? 'Humanization failed.'}</p>
        ) : outputText ? outputText : (
          <span className="text-gray-300 italic">Your humanized text will appear here…</span>
        )}
      </div>
      <div className="flex items-center justify-between px-4 py-3 border-t border-gray-200 shrink-0">
        <span className="text-xs text-gray-400">{wordCount(outputText)} Words</span>
        <div className="flex items-center gap-3">
          {output && <ExportMenu />}
          <button onClick={handleCopy} disabled={!outputText} title={copied ? 'Copied!' : 'Copy'}
            className="text-gray-300 hover:text-gray-700 transition-colors disabled:opacity-30">
            {copied ? (
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path d="M2 8l4 4 8-8" stroke="#22c55e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
                <rect x="5" y="1" width="9" height="11" rx="2" stroke="currentColor" strokeWidth="1.3" />
                <path d="M3 4H2a1 1 0 00-1 1v8a1 1 0 001 1h8a1 1 0 001-1v-1" stroke="currentColor" strokeWidth="1.3" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  )

  return (
    <>
    <ApiConfigModal open={apiConfigOpen} onClose={() => setApiConfigOpen(false)} />

    {/* ══════════════════════════════════════════════════════════════
        DESKTOP  (md+)
        ══════════════════════════════════════════════════════════════ */}
    <div className="relative hidden md:flex flex-col items-center min-h-screen py-6 px-6 bg-white overflow-hidden">
      <Image
        src="/images/AppDesktopBackground.PNG"
        alt=""
        fill
        priority
        sizes="100vw"
        className="object-cover"
        aria-hidden
      />
      <div className="relative z-10 w-full max-w-6xl rounded-2xl overflow-hidden flex flex-col
                      bg-white border border-gray-200 shadow-md"
        style={{ minHeight: 'calc(100vh - 3rem)' }}>
        {/* Desktop header */}
        <header className="flex items-center justify-between px-5 py-3.5 border-b border-gray-200 shrink-0">
          <div className="flex items-center gap-2.5">
            <span className="text-base font-bold text-gray-900">
              Humanite
            </span>
          </div>
          <div className="flex items-center gap-3">
            <PresetSelector />
            <button
              onClick={() => setApiConfigOpen(true)}
              title={hasCustomConfig() ? `Using: ${apiConfig.nickname || apiConfig.modelId}` : 'Configure AI model'}
              className="relative flex items-center justify-center w-7 h-7 rounded-lg
                         text-gray-400 hover:text-gray-800 hover:bg-gray-100
                         transition-colors focus:outline-none"
            >
              <svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden>
                <circle cx="10" cy="10" r="3" stroke="currentColor" strokeWidth="1.4"/>
                <path d="M10 1v2M10 17v2M1 10h2M17 10h2M3.22 3.22l1.42 1.42M15.36 15.36l1.42 1.42M3.22 16.78l1.42-1.42M15.36 4.64l1.42-1.42"
                  stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              </svg>
              {hasCustomConfig() && (
                <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-green-500" />
              )}
            </button>
            <span className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full
                             border border-gray-200 bg-gray-100 text-gray-600">
              {(tier ?? 'free').charAt(0).toUpperCase() + (tier ?? 'free').slice(1)} Plan
            </span>
            <button onClick={handleClear}
              className="text-xs text-gray-400 hover:text-gray-700 transition-colors">Clear</button>
          </div>
        </header>
        <div className="flex flex-col flex-1 min-h-0 p-5 gap-4">

          {/* Two panels + centre orb */}
          <div className="grid flex-1 min-h-0" style={{ gridTemplateColumns: '1fr 108px 1fr', minHeight: '320px' }}>
            {inputPanel}

            {/* Centre action */}
            <div className="flex flex-col items-center justify-center gap-4 px-2">
              <button
                aria-label="Humanize"
                onClick={() => humanize(text)}
                disabled={!canSubmit || hLoading}
                className="relative w-[72px] h-[72px] rounded-full flex items-center justify-center
                           bg-gray-900 hover:bg-gray-800
                           disabled:opacity-40 disabled:cursor-not-allowed
                           transition-transform hover:scale-105 active:scale-95
                           focus:outline-none focus:ring-2 focus:ring-gray-900/30"
              >
                {hLoading
                  ? <Spinner className="w-5 h-5 border-white/30 border-t-white" />
                  : (
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path d="M5 12h14M13 6l6 6-6 6" stroke="white" strokeWidth="2"
                        strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )
                }
              </button>
              <button
                onClick={() => scan(text)}
                disabled={!canSubmit || sLoading}
                className="text-xs text-gray-400 hover:text-gray-800 transition-colors
                           disabled:opacity-30 flex items-center gap-1.5 focus:outline-none"
              >
                {sLoading && <Spinner className="w-3 h-3 border-gray-200 border-t-gray-600" />}
                Scan
              </button>
            </div>

            {outputPanel}
          </div>

          {/* Settings */}
          <ControlPanel />

          {/* Stats — only after first result */}
          {(output || showScan) && (
            <div className="bg-white border border-gray-200 rounded-2xl px-6 py-4 shrink-0">
              <div className="flex items-center gap-6 flex-wrap">

                {output && (
                  <>
                    <div className="flex items-center gap-3">
                      {humanScore != null ? (
                        <CircularScore pct={humanScore} />
                      ) : (
                        <div className="w-[68px] h-[68px] rounded-full border border-gray-200
                                        flex items-center justify-center text-gray-400 text-xs">
                          —
                        </div>
                      )}
                      <div>
                        <p className="text-sm font-semibold text-gray-700">Human Score</p>
                        <p className={`text-sm font-bold ${humanScore != null ? 'text-green-600' : 'text-gray-400'}`}>
                          {scoreLabel}
                        </p>
                      </div>
                    </div>
                    <div className="w-px h-12 bg-gray-200" />
                  </>
                )}

                {showScan && (
                  <>
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full flex items-center justify-center
                                      bg-gray-100 border border-gray-200">
                        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden>
                          <path d="M10 2l1.5 4.5L16 8l-4.5 2L10 14l-1.5-4L4 8l4.5-1.5L10 2z"
                            stroke="#374151" strokeWidth="1.3" strokeLinejoin="round" />
                        </svg>
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-gray-700">AI Detection</p>
                        <p className={`text-sm font-bold ${
                          aiDetLabel === 'Undetectable' ? 'text-green-600'
                          : aiDetLabel === 'Detected'   ? 'text-red-500'
                          : aiDetLabel === 'Partial'    ? 'text-amber-500'
                          : 'text-gray-400'
                        }`}>{aiDetLabel ?? 'Run scan'}</p>
                      </div>
                    </div>
                    {output && <div className="w-px h-12 bg-gray-200" />}
                  </>
                )}

                {output && (
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center border ${
                      output.quality_scores.passed === true ? 'bg-green-50 border-green-200'
                      : output.quality_scores.passed === false ? 'bg-red-50 border-red-200'
                      : 'bg-gray-50 border-gray-200'
                    }`}>
                      <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden>
                        <circle cx="10" cy="10" r="7.5"
                          stroke={output.quality_scores.passed === true ? '#22c55e' : output.quality_scores.passed === false ? '#ef4444' : '#d1d5db'}
                          strokeWidth="1.4" />
                        <path d="M6.5 10l2.5 2.5 5-5"
                          stroke={output.quality_scores.passed === true ? '#22c55e' : output.quality_scores.passed === false ? '#ef4444' : '#d1d5db'}
                          strokeWidth="1.4" strokeLinecap="round" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-700">Fidelity check</p>
                      <p className={`text-sm font-bold ${
                        output.quality_scores.passed === true ? 'text-green-600'
                        : output.quality_scores.passed === false ? 'text-red-500'
                        : 'text-gray-400'
                      }`}
                        title={
                          output.quality_scores.passed === false
                            ? [...output.quality_scores.missing_facts.map(f => `Dropped: "${f}"`),
                               ...output.quality_scores.entailment_issues].join('\n') || undefined
                            : undefined
                        }
                      >
                        {output.quality_scores.passed === true ? 'Natural'
                          : output.quality_scores.passed === false ? `Review (${output.quality_scores.failed_gate})`
                          : 'Not yet scored'}
                      </p>
                    </div>
                  </div>
                )}

              </div>
            </div>
          )}
        </div>
      </div>
    </div>

    {/* ══════════════════════════════════════════════════════════════
        MOBILE  (<md)
        ══════════════════════════════════════════════════════════════ */}
    <div className="relative md:hidden flex flex-col bg-white p-2" style={{ height: '100dvh' }}>
      <Image
        src="/images/AppIphoneBackground.PNG"
        alt=""
        fill
        priority
        sizes="100vw"
        className="object-cover"
        aria-hidden
      />

      {/* ── Drawer backdrop ── */}
      {menuOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/30"
          onClick={() => setMenuOpen(false)}
        />
      )}

      {/* ── Drawer panel (slides from right) ── */}
      <div

        className="fixed top-0 right-0 bottom-0 z-50 w-[82vw] max-w-xs flex flex-col
                   bg-white border-l border-gray-200
                   transition-transform duration-300 ease-out"
        style={{ transform: menuOpen ? 'translateX(0)' : 'translateX(100%)' }}
      >
        {/* Drawer header */}
        <div className="flex items-center justify-between px-5 pt-12 pb-4 border-b border-gray-200 shrink-0">
          <span className="text-sm font-semibold text-gray-500 uppercase tracking-wider">Menu</span>
          <button
            onClick={() => setMenuOpen(false)}
            className="w-8 h-8 flex items-center justify-center rounded-full
                       bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path d="M2 2l12 12M14 2L2 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Tier badge */}
          <div className="px-5 py-4 border-b border-gray-200">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold
                             px-3 py-1.5 rounded-full border border-gray-200
                             bg-gray-100 text-gray-600">
              {(tier ?? 'free').charAt(0).toUpperCase() + (tier ?? 'free').slice(1)} Plan
            </span>
          </div>

          {/* Presets */}
          <div className="px-5 py-4 border-b border-gray-200">
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-3">Presets</p>
            <PresetSelector />
          </div>

          {/* AI Model Config */}
          <div className="px-5 py-4 border-b border-gray-200">
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-3">AI Model</p>
            <button
              onClick={() => { setMenuOpen(false); setApiConfigOpen(true) }}
              className="w-full flex items-center justify-between px-3.5 py-2.5
                         rounded-xl bg-gray-50 border border-gray-200
                         hover:bg-gray-100 transition-colors text-left"
            >
              <div className="flex items-center gap-2.5">
                <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden>
                  <circle cx="10" cy="10" r="3" stroke="#374151" strokeWidth="1.4"/>
                  <path d="M10 1v2M10 17v2M1 10h2M17 10h2M3.22 3.22l1.42 1.42M15.36 15.36l1.42 1.42M3.22 16.78l1.42-1.42M15.36 4.64l1.42-1.42"
                    stroke="#374151" strokeWidth="1.4" strokeLinecap="round"/>
                </svg>
                <span className="text-sm text-gray-600">
                  {hasCustomConfig()
                    ? (apiConfig.nickname || apiConfig.modelId)
                    : 'Configure model'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {hasCustomConfig() && (
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                )}
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
                  <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
            </button>
          </div>

          {/* Settings */}
          <div className="px-5 py-5">
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-3">Settings</p>
            <ControlPanel />
          </div>
        </div>

        {/* Drawer footer actions */}
        <div className="shrink-0 px-5 py-5 border-t border-gray-200 space-y-1"
          style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}>
          <button
            onClick={() => { setMenuOpen(false); handleClear() }}
            className="w-full text-left text-sm text-gray-500 hover:text-gray-800
                       py-2.5 px-3 rounded-xl hover:bg-gray-100 transition-all"
          >
            Clear all
          </button>
        </div>
      </div>

      {/* ── Card shell — lets AppIphoneBackground peek through at the edges ── */}
      <div className="relative z-10 flex flex-col flex-1 min-h-0 overflow-hidden rounded-3xl bg-white shadow-xl">

      {/* ── Mobile header ── */}
      <header className="shrink-0 flex items-center justify-between px-4 bg-white border-b border-gray-200"
        style={{ height: '52px' }}>
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-gray-900">
            Humanite
          </span>
        </div>
        <button
          onClick={() => setMenuOpen(true)}
          className="w-9 h-9 flex flex-col items-center justify-center gap-[5px]
                     rounded-xl bg-gray-100 hover:bg-gray-200 transition-colors"
          aria-label="Open menu"
        >
          <span className="w-4 h-px bg-gray-500 rounded-full" />
          <span className="w-4 h-px bg-gray-500 rounded-full" />
          <span className="w-2.5 h-px bg-gray-500 rounded-full self-start ml-2.5" />
        </button>
      </header>

      {/* ── Main content (tab panels) ── */}
      <div className="flex-1 min-h-0 overflow-hidden">

        {/* Input tab */}
        {mobileTab === 'input' && (
          <div className="h-full flex flex-col">
            <textarea
              value={text}
              onChange={e => setText(e.target.value.slice(0, MAX_CHARS))}
              placeholder="Paste your AI-generated text here…"
              className="flex-1 bg-transparent resize-none text-gray-800 leading-relaxed
                         px-5 pt-5 pb-3 outline-none placeholder-gray-400 font-sans"
              style={{ fontSize: '16px' }}
            />
            <div className="shrink-0 flex items-center justify-between px-5 py-3 border-t border-gray-200">
              <span className="text-xs text-gray-400">
                {wordCount(text)} words
                {text.length > SYNC_MAX_CHARS && ' · background'}
              </span>
              {text.length > 0 && (
                <button
                  onClick={handleClear}
                  className="text-xs text-gray-400 hover:text-gray-700 transition-colors"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        )}

        {/* Output tab */}
        {mobileTab === 'output' && (
          <div className="h-full flex flex-col">
            {/* Quality chips */}
            {output && (
              <div className="shrink-0 flex gap-2 px-4 pt-3 pb-2 flex-wrap border-b border-gray-200">
                <span className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium border ${
                  humanScore != null
                    ? 'bg-green-50 border-green-200 text-green-700'
                    : 'bg-gray-50 border-gray-200 text-gray-500'
                }`}>
                  {humanScore != null && <span className="w-1.5 h-1.5 rounded-full bg-green-500" />}
                  {humanScore != null ? `${humanScore}% Human · ${scoreLabel}` : scoreLabel}
                </span>
                {output.quality_scores.passed && (
                  <span className="text-xs px-2.5 py-1 rounded-full font-medium
                                   bg-gray-100 border border-gray-200 text-gray-700">
                    Natural
                  </span>
                )}
                {aiDetLabel && (
                  <span className={`text-xs px-2.5 py-1 rounded-full font-medium border ${
                    aiDetLabel === 'Undetectable'
                      ? 'bg-green-50 border-green-200 text-green-700'
                      : aiDetLabel === 'Detected'
                      ? 'bg-red-50 border-red-200 text-red-700'
                      : 'bg-amber-50 border-amber-200 text-amber-700'
                  }`}>
                    {aiDetLabel}
                  </span>
                )}
              </div>
            )}

            {response?.warning && hStatus === 'done' && (
              <div className="shrink-0 px-4 py-2 bg-amber-50 border-b border-amber-200 text-xs text-amber-700">
                ⚠ {response.warning}
              </div>
            )}

            {/* Output text */}
            <div className="flex-1 overflow-y-auto px-5 py-4 leading-relaxed whitespace-pre-wrap text-gray-800"
              style={{ fontSize: '16px' }}>
              {hLoading ? (
                <div className="h-full flex items-center justify-center">
                  <div className="text-center px-6">
                    <Spinner className="w-8 h-8 border-gray-200 border-t-gray-700 block mx-auto mb-3" />
                    <p className="text-sm text-gray-500">{progressMessage ? 'Processing…' : 'Rewriting…'}</p>
                    <p className="text-xs text-gray-400 mt-1">{progressMessage ?? 'Validating quality'}</p>
                  </div>
                </div>
              ) : hStatus === 'error' ? (
                <div className="p-4 rounded-2xl bg-red-50 border border-red-200">
                  <p className="text-sm text-red-600">{error ?? 'Humanization failed.'}</p>
                </div>
              ) : outputText ? outputText : (
                <div className="h-full flex items-center justify-center">
                  <p className="text-sm text-gray-400 italic text-center px-6">
                    Your humanized text will appear here…
                  </p>
                </div>
              )}
            </div>

            {/* Output actions */}
            {outputText && (
              <div className="shrink-0 flex items-center justify-between px-4 py-3 border-t border-gray-200">
                <span className="text-xs text-gray-400">{wordCount(outputText)} words</span>
                <div className="flex items-center gap-4">
                  {output && <ExportMenu />}
                  <button
                    onClick={handleCopy}
                    className="flex items-center gap-1.5 text-sm font-medium
                               text-gray-700 hover:text-gray-900 transition-colors"
                  >
                    {copied ? (
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
                        <path d="M2 8l4 4 8-8" stroke="#22c55e" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
                        <rect x="5" y="1" width="9" height="11" rx="2" stroke="currentColor" strokeWidth="1.3"/>
                        <path d="M3 4H2a1 1 0 00-1 1v8a1 1 0 001 1h8a1 1 0 001-1v-1" stroke="currentColor" strokeWidth="1.3"/>
                      </svg>
                    )}
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Scan tab */}
        {mobileTab === 'scan' && (
          <div className="h-full overflow-y-auto">
            <ScanReport />
          </div>
        )}
      </div>

      {/* ── Action bar (Input tab only) ── */}
      {mobileTab === 'input' && (
        <div className="shrink-0 px-4 py-3 bg-white border-t border-gray-200">
          <div className="flex gap-3">
            <button
              onClick={() => humanize(text)}
              disabled={!canSubmit || hLoading}
              className="flex-1 py-3.5 text-sm font-bold rounded-2xl text-white
                         bg-gray-900
                         disabled:opacity-30 disabled:cursor-not-allowed
                         active:scale-[0.98] transition-transform focus:outline-none"
            >
              {hLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <Spinner className="w-4 h-4 border-white/30 border-t-white" />
                  Humanizing…
                </span>
              ) : 'Humanize'}
            </button>
            <button
              onClick={() => scan(text)}
              disabled={!canSubmit || sLoading}
              className="px-5 py-3.5 text-sm font-semibold text-gray-700
                         bg-gray-100 border border-gray-200 rounded-2xl
                         disabled:opacity-30 disabled:cursor-not-allowed
                         active:scale-[0.98] transition-transform focus:outline-none"
            >
              {sLoading
                ? <Spinner className="w-4 h-4 border-gray-300 border-t-gray-600" />
                : 'Scan'}
            </button>
          </div>
        </div>
      )}

      {/* ── Tab bar ── */}
      <nav
        className="shrink-0 flex bg-white border-t border-gray-200"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {([
          { id: 'input',  label: 'Write', icon: (
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <rect x="2" y="2" width="16" height="16" rx="3" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M5 7h10M5 10.5h7M5 14h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          )},
          { id: 'output', label: 'Result', icon: (
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.5"/>
              <path d="M7 10l2 2 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          )},
          { id: 'scan',   label: 'Scan', icon: (
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M10 2L12.5 8 19 10l-6.5 2.5L10 18l-2.5-5.5L1 10l6.5-2L10 2z"
                stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
            </svg>
          )},
        ] as const).map(tab => {
          const active   = mobileTab === tab.id
          const hasBadge = (tab.id === 'output' && hStatus !== 'idle')
                        || (tab.id === 'scan'   && showScan)
          return (
            <button
              key={tab.id}
              onClick={() => setMobileTab(tab.id as MobileTab)}
              className={`flex-1 flex flex-col items-center gap-1 py-3 text-[11px] font-medium
                          transition-colors relative
                          ${active ? 'text-gray-900' : 'text-gray-400 hover:text-gray-600'}`}
            >
              {tab.icon}
              {tab.label}
              {hasBadge && !active && (
                <span className="absolute top-2.5 right-[calc(50%-16px)] w-1.5 h-1.5
                                 rounded-full bg-gray-900" />
              )}
            </button>
          )
        })}
      </nav>

      </div>
    </div>
    </>
  )
}

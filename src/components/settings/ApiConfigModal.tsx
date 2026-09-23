'use client'
import { useState, useEffect } from 'react'
import { useApiConfigStore, ApiConfig } from '@/stores/apiConfigStore'

interface Props {
  open: boolean
  onClose: () => void
}

export function ApiConfigModal({ open, onClose }: Props) {
  const { config, setConfig, clearConfig, hasCustomConfig, syncFromServer } = useApiConfigStore()
  const [draft, setDraft] = useState<ApiConfig>(config)
  const [showKey, setShowKey] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (open) { setDraft(config); setSaved(false); setShowKey(false) }
  }, [open, config])

  // Pull the latest config saved from any other device — resolves into
  // `config` above, which the effect above then reflects into `draft`.
  useEffect(() => {
    if (open) syncFromServer()
  }, [open, syncFromServer])

  if (!open) return null

  const patch = (field: keyof ApiConfig) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setDraft(prev => ({ ...prev, [field]: e.target.value }))

  const handleSave = () => {
    setConfig(draft)
    setSaved(true)
    setTimeout(() => { setSaved(false); onClose() }, 800)
  }

  const handleClear = () => { clearConfig(); setDraft({ nickname: '', modelId: '', baseUrl: '', apiKey: '' }) }

  const isActive = hasCustomConfig()

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* backdrop */}
      <div
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
      />

      {/* panel */}
      <div className="relative w-full max-w-md rounded-2xl flex flex-col overflow-hidden
                       bg-white border border-gray-200 shadow-xl">
        {/* header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <div className="flex items-center gap-2.5">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden>
              <circle cx="10" cy="10" r="3" stroke="#374151" strokeWidth="1.4"/>
              <path d="M10 1v2M10 17v2M1 10h2M17 10h2M3.22 3.22l1.42 1.42M15.36 15.36l1.42 1.42M3.22 16.78l1.42-1.42M15.36 4.64l1.42-1.42"
                stroke="#374151" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
            <span className="text-sm font-semibold text-gray-800">AI Model Config</span>
            {isActive && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full
                               bg-gray-900 text-white">
                Active
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-full
                       bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors"
          >
            <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden>
              <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* body */}
        <div className="px-5 py-5 space-y-4">
          <p className="text-xs text-gray-500 leading-relaxed">
            Override the server&apos;s default model. Leave blank to use the server default.
            Saved on this device and synced across your other devices when
            cloud sync is configured.
          </p>

          {/* Nickname */}
          <label className="block">
            <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
              Model nickname
            </span>
            <input
              type="text"
              value={draft.nickname}
              onChange={patch('nickname')}
              placeholder="e.g. My GPT-4o"
              className="mt-1.5 w-full bg-white border border-gray-300 rounded-xl
                         px-3.5 py-2.5 text-sm text-gray-800 placeholder-gray-400
                         outline-none focus:border-gray-900 transition-colors"
            />
          </label>

          {/* Model ID */}
          <label className="block">
            <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
              Model ID <span className="text-gray-900">*</span>
            </span>
            <input
              type="text"
              value={draft.modelId}
              onChange={patch('modelId')}
              placeholder="e.g. gpt-4o-mini"
              className="mt-1.5 w-full bg-white border border-gray-300 rounded-xl
                         px-3.5 py-2.5 text-sm text-gray-800 placeholder-gray-400
                         outline-none focus:border-gray-900 transition-colors"
            />
          </label>

          {/* Base URL */}
          <label className="block">
            <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
              Base URL
            </span>
            <input
              type="url"
              value={draft.baseUrl}
              onChange={patch('baseUrl')}
              placeholder="e.g. https://api.openai.com/v1"
              className="mt-1.5 w-full bg-white border border-gray-300 rounded-xl
                         px-3.5 py-2.5 text-sm text-gray-800 placeholder-gray-400
                         outline-none focus:border-gray-900 transition-colors"
            />
          </label>

          {/* API Key */}
          <label className="block">
            <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
              API Key <span className="text-gray-900">*</span>
            </span>
            <div className="relative mt-1.5">
              <input
                type={showKey ? 'text' : 'password'}
                value={draft.apiKey}
                onChange={patch('apiKey')}
                placeholder="sk-…"
                className="w-full bg-white border border-gray-300 rounded-xl
                           px-3.5 py-2.5 pr-10 text-sm text-gray-800 placeholder-gray-400
                           outline-none focus:border-gray-900 transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowKey(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2
                           text-gray-400 hover:text-gray-700 transition-colors"
                aria-label={showKey ? 'Hide key' : 'Show key'}
              >
                {showKey ? (
                  <svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden>
                    <path d="M2 10s3-6 8-6 8 6 8 6-3 6-8 6-8-6-8-6z" stroke="currentColor" strokeWidth="1.4"/>
                    <circle cx="10" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.4"/>
                    <path d="M3 3l14 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                  </svg>
                ) : (
                  <svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden>
                    <path d="M2 10s3-6 8-6 8 6 8 6-3 6-8 6-8-6-8-6z" stroke="currentColor" strokeWidth="1.4"/>
                    <circle cx="10" cy="10" r="2.5" stroke="currentColor" strokeWidth="1.4"/>
                  </svg>
                )}
              </button>
            </div>
          </label>
        </div>

        {/* footer */}
        <div className="flex items-center justify-between px-5 pb-5 gap-3">
          <button
            onClick={handleClear}
            className="text-xs text-gray-400 hover:text-gray-700 transition-colors py-1"
          >
            Clear config
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="text-xs font-medium text-gray-500 hover:text-gray-800
                         px-4 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!draft.apiKey.trim() && !draft.modelId.trim()}
              className="text-xs font-semibold text-white px-4 py-2 rounded-xl
                         disabled:opacity-30 disabled:cursor-not-allowed transition-colors
                         bg-gray-900 hover:bg-gray-800"
            >
              {saved ? 'Saved ✓' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

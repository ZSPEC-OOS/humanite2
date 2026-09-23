'use client'
import { useEffect, useState } from 'react'
import { useHumanizeStore } from '@/stores/humanizeStore'
import { apiListPresets, apiCreatePreset, apiDeletePreset, Preset, APIError } from '@/lib/api'
import { selectCls, inputCls } from '@/components/ui/styles'

export function PresetSelector() {
  const { settings, setSettings }         = useHumanizeStore()
  const [presets, setPresets]             = useState<Preset[]>([])
  const [saveName, setSaveName]           = useState('')
  const [showSaveForm, setShowSaveForm]   = useState(false)
  const [saving, setSaving]               = useState(false)
  const [error, setError]                 = useState<string | null>(null)

  useEffect(() => {
    apiListPresets().then(setPresets).catch(() => {})
  }, [])

  const handleLoad = (preset: Preset) => {
    setSettings({
      intensity: preset.intensity,
      tone: preset.tone,
      domain: preset.domain,
      preserve_citations: preset.preserve_citations,
    })
  }

  const handleSave = async () => {
    if (!saveName.trim()) return
    setSaving(true); setError(null)
    try {
      const created = await apiCreatePreset({
        name: saveName.trim(),
        intensity: settings.intensity,
        tone: settings.tone,
        domain: settings.domain,
        preserve_citations: settings.preserve_citations,
      })
      setPresets(prev => [created, ...prev])
      setSaveName('')
      setShowSaveForm(false)
    } catch (e) {
      setError(e instanceof APIError ? e.message : 'Failed to save preset.')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (presetId: string) => {
    try {
      await apiDeletePreset(presetId)
      setPresets(prev => prev.filter(p => p.id !== presetId))
    } catch { /* non-critical */ }
  }

  return (
    <div className="flex items-center gap-2">
      {presets.length > 0 && (
        <select
          onChange={(e) => {
            const preset = presets.find(p => p.id === e.target.value)
            if (preset) handleLoad(preset)
            e.target.value = ''
          }}
          defaultValue=""
          className={`${selectCls} max-w-[140px]`}
        >
          <option value="" disabled>Load preset…</option>
          {presets.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      )}

      {showSaveForm ? (
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSave() }}
            placeholder="Preset name…"
            maxLength={100}
            className={`${inputCls} w-28`}
            autoFocus
          />
          <button
            onClick={handleSave}
            disabled={!saveName.trim() || saving}
            className="text-xs px-2.5 py-1.5 rounded-lg bg-gray-900 text-white
                       hover:bg-gray-800 disabled:opacity-40 transition-colors"
          >
            {saving ? '…' : 'Save'}
          </button>
          <button
            onClick={() => { setShowSaveForm(false); setSaveName(''); setError(null) }}
            className="text-xs text-gray-400 hover:text-gray-700 px-1"
          >✕</button>
          {error && <span className="text-xs font-medium text-gray-900">{error}</span>}
        </div>
      ) : (
        <button
          onClick={() => setShowSaveForm(true)}
          className="text-xs text-gray-400 hover:text-gray-900 transition-colors"
          title="Save current settings as preset"
        >
          + Save preset
        </button>
      )}
    </div>
  )
}

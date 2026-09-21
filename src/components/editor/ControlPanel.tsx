'use client'
import { useHumanizeStore } from '@/stores/humanizeStore'

const TONES   = ['balanced', 'formal', 'casual', 'academic', 'professional']
const DOMAINS = ['general', 'academic', 'business', 'technical', 'medical', 'legal']

const INTENSITY_TICKS = [
  { v: 1,  label: 'Minimal'    },
  { v: 2,  label: 'Light'      },
  { v: 6,  label: 'Moderate'   },
  { v: 7,  label: 'Heavy'      },
  { v: 10, label: 'Aggressive' },
]

const selectCls = `text-sm rounded-xl px-4 py-2 bg-white/5 border border-white/10 text-white/70
                   focus:outline-none focus:border-violet-500/60 appearance-none cursor-pointer
                   min-w-[130px]`

export function ControlPanel() {
  const { settings, setSettings } = useHumanizeStore()

  return (
    <div className="bg-[#0a0a18] border border-white/8 rounded-2xl px-5 py-4 shrink-0">
      <div className="flex flex-wrap items-start gap-x-8 gap-y-5">

        {/* Intensity */}
        <div className="flex-1 min-w-[180px]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-white/70">Intensity</span>
            <span className="text-xs font-bold text-violet-400">{settings.intensity}</span>
          </div>
          <input
            type="range" min={1} max={10} step={1}
            value={settings.intensity}
            onChange={e => setSettings({ intensity: Number(e.target.value) })}
            className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
            style={{ accentColor: '#a855f7' }}
          />
          <div className="flex justify-between mt-2">
            {INTENSITY_TICKS.map(t => (
              <div key={t.v} className="flex flex-col items-center gap-0.5">
                <span className="text-[10px] text-white/35 font-medium tabular-nums">{t.v}</span>
                <span className="text-[9px] text-white/20">{t.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="w-px self-stretch bg-white/8 hidden sm:block" />

        {/* Tone */}
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-white/40 uppercase tracking-wider">Tone</span>
          <select
            value={settings.tone}
            onChange={e => setSettings({ tone: e.target.value })}
            className={selectCls}
          >
            {TONES.map(t => (
              <option key={t} value={t} style={{ background: '#0a0a18' }}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </option>
            ))}
          </select>
        </div>

        <div className="w-px self-stretch bg-white/8 hidden sm:block" />

        {/* Domain */}
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-white/40 uppercase tracking-wider">Domain</span>
          <select
            value={settings.domain}
            onChange={e => setSettings({ domain: e.target.value })}
            className={selectCls}
          >
            {DOMAINS.map(d => (
              <option key={d} value={d} style={{ background: '#0a0a18' }}>
                {d.charAt(0).toUpperCase() + d.slice(1)}
              </option>
            ))}
          </select>
        </div>

        <div className="w-px self-stretch bg-white/8 hidden sm:block" />

        {/* Preserve citations */}
        <label className="flex flex-col gap-2 cursor-pointer select-none">
          <span className="text-xs font-medium text-white/40 uppercase tracking-wider">
            Preserve citations
          </span>
          <div className="flex items-center gap-2.5">
            <input
              type="checkbox"
              checked={settings.preserve_citations}
              onChange={e => setSettings({ preserve_citations: e.target.checked })}
              className="w-5 h-5 rounded cursor-pointer"
              style={{ accentColor: '#a855f7' }}
            />
            <span className="text-sm text-white/50">
              {settings.preserve_citations ? 'On' : 'Off'}
            </span>
          </div>
        </label>

      </div>
    </div>
  )
}

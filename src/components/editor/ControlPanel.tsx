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

const selectCls = `text-sm rounded-xl px-4 py-2 bg-white border border-gray-300 text-gray-700
                   dark:bg-gray-900 dark:border-gray-700 dark:text-gray-300
                   focus:outline-none focus:border-gray-900 dark:focus:border-gray-100 appearance-none cursor-pointer
                   min-w-[130px]`

export function ControlPanel() {
  const { settings, setSettings } = useHumanizeStore()

  return (
    <div className="bg-white border border-gray-200 rounded-2xl px-5 py-4 shrink-0 dark:bg-gray-900 dark:border-gray-800">
      <div className="flex flex-wrap items-start gap-x-8 gap-y-5">

        {/* Intensity */}
        <div className="flex-1 min-w-[180px]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">Intensity</span>
            <span className="text-xs font-bold text-gray-900 dark:text-gray-100">{settings.intensity}</span>
          </div>
          <input
            type="range" min={1} max={10} step={1}
            value={settings.intensity}
            onChange={e => setSettings({ intensity: Number(e.target.value) })}
            className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
            style={{ accentColor: 'var(--accent)' }}
          />
          {/* Positioned by percent-of-range rather than flex justify-between —
              the ticks aren't evenly spaced values (1, 2, 6, 7, 10), so even
              spacing made a tick's label land beside a different slider
              position than the value it names (e.g. "6" sitting under where
              the thumb actually reads ~7 out of the 1-10 range). */}
          <div className="relative mt-2 h-7">
            {INTENSITY_TICKS.map(t => (
              <div
                key={t.v}
                className="absolute top-0 flex flex-col items-center gap-0.5"
                style={{
                  left: `${((t.v - 1) / 9) * 100}%`,
                  transform:
                    t.v === 1 ? 'translateX(0)'
                    : t.v === 10 ? 'translateX(-100%)'
                    : 'translateX(-50%)',
                }}
              >
                <span className="text-[10px] text-gray-500 dark:text-gray-400 font-medium tabular-nums">{t.v}</span>
                <span className="text-[9px] text-gray-400 dark:text-gray-500 whitespace-nowrap">{t.label}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="w-px self-stretch bg-gray-200 dark:bg-gray-800 hidden sm:block" />

        {/* Tone */}
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider">Tone</span>
          <select
            value={settings.tone}
            onChange={e => setSettings({ tone: e.target.value })}
            className={selectCls}
          >
            {TONES.map(t => (
              <option key={t} value={t}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </option>
            ))}
          </select>
        </div>

        <div className="w-px self-stretch bg-gray-200 dark:bg-gray-800 hidden sm:block" />

        {/* Domain */}
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider">Domain</span>
          <select
            value={settings.domain}
            onChange={e => setSettings({ domain: e.target.value })}
            className={selectCls}
          >
            {DOMAINS.map(d => (
              <option key={d} value={d}>
                {d.charAt(0).toUpperCase() + d.slice(1)}
              </option>
            ))}
          </select>
        </div>

      </div>
    </div>
  )
}

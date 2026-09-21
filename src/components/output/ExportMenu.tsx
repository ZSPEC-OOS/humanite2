'use client'
import { useState } from 'react'
import { useHumanizeStore } from '@/stores/humanizeStore'
import { apiExport }        from '@/lib/api'
import { Spinner }          from '@/components/ui/Spinner'

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a   = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click()
  document.body.removeChild(a); URL.revokeObjectURL(url)
}

const FORMATS = [
  { key: 'text',     label: 'TXT',  ext: 'txt'  },
  { key: 'markdown', label: 'MD',   ext: 'md'   },
  { key: 'docx',     label: 'DOCX', ext: 'docx' },
] as const

export function ExportMenu() {
  const { response }          = useHumanizeStore()
  const [loading, setLoading] = useState<string | null>(null)
  const [error, setError]     = useState<string | null>(null)

  const output = response?.output
  if (!output) return null

  const handleExport = async (format: 'text' | 'markdown' | 'docx') => {
    if (!output.watermark || !response?.job_id) return
    setLoading(format); setError(null)
    try {
      const blob     = await apiExport(output.text, format,
                         output.watermark as Record<string, string>, response.job_id)
      const ext      = FORMATS.find(f => f.key === format)?.ext ?? format
      const filename = `humanite-${response.job_id.slice(0, 8)}.${ext}`
      downloadBlob(blob, filename)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed.')
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-white/30">Export:</span>
      {FORMATS.map(({ key, label }) => (
        <button
          key={key}
          onClick={() => handleExport(key)}
          disabled={loading !== null}
          className="text-xs px-2.5 py-1 rounded-lg border
                     bg-white/5 border-white/10 text-white/50
                     hover:bg-white/10 hover:border-white/20 hover:text-white/80
                     disabled:opacity-40 disabled:cursor-not-allowed
                     transition-all"
        >
          {loading === key ? (
            <span className="flex items-center gap-1">
              <Spinner className="w-2.5 h-2.5 border-white/30 border-t-white/70" />
              {label}
            </span>
          ) : label}
        </button>
      ))}
      {error && <span className="text-xs text-red-400 ml-1">{error}</span>}
    </div>
  )
}

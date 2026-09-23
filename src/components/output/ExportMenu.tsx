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
      const blob     = await apiExport(output.text, format, response.job_id)
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
      <span className="text-xs text-gray-400 dark:text-gray-500">Export:</span>
      {FORMATS.map(({ key, label }) => (
        <button
          key={key}
          onClick={() => handleExport(key)}
          disabled={loading !== null}
          className="text-xs px-2.5 py-1 rounded-lg border
                     bg-gray-50 border-gray-200 text-gray-600
                     hover:bg-gray-100 hover:border-gray-300 hover:text-gray-900
                     dark:bg-gray-800 dark:border-gray-700 dark:text-gray-400
                     dark:hover:bg-gray-700 dark:hover:border-gray-600 dark:hover:text-gray-100
                     disabled:opacity-40 disabled:cursor-not-allowed
                     transition-all"
        >
          {loading === key ? (
            <span className="flex items-center gap-1">
              <Spinner className="w-2.5 h-2.5 border-gray-300 border-t-gray-600 dark:border-gray-600 dark:border-t-gray-300" />
              {label}
            </span>
          ) : label}
        </button>
      ))}
      {error && <span className="text-xs font-medium text-gray-900 dark:text-gray-100 ml-1">{error}</span>}
    </div>
  )
}

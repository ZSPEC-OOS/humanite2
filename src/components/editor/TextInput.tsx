'use client'
import { useEditorStore } from '@/stores/editorStore'

const MAX_CHARS = 10_000

export function TextInput() {
  const { text, setText } = useEditorStore()
  const overLimit = text.length > MAX_CHARS

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-900">
      <textarea
        value={text}
        onChange={e => setText(e.target.value.slice(0, MAX_CHARS))}
        placeholder="Paste your AI-generated text here…"
        className="flex-1 bg-transparent resize-none text-sm text-gray-800 dark:text-gray-200 leading-relaxed
                   px-4 py-4 outline-none placeholder-gray-400 dark:placeholder-gray-600 font-sans"
      />
      <div className="flex items-center justify-end px-4 py-2 border-t border-gray-200 dark:border-gray-800 shrink-0">
        <span className={`text-xs tabular-nums ${overLimit ? 'text-gray-900 dark:text-gray-100 font-semibold' : 'text-gray-400 dark:text-gray-500'}`}>
          {text.length.toLocaleString()} / {MAX_CHARS.toLocaleString()}
        </span>
      </div>
    </div>
  )
}

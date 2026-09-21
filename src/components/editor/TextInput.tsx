'use client'
import { useEditorStore } from '@/stores/editorStore'

const MAX_CHARS = 10_000

export function TextInput() {
  const { text, setText } = useEditorStore()
  const overLimit = text.length > MAX_CHARS

  return (
    <div className="flex flex-col h-full bg-[#0a0a18]">
      <textarea
        value={text}
        onChange={e => setText(e.target.value.slice(0, MAX_CHARS))}
        placeholder="Paste your AI-generated text here…"
        className="flex-1 bg-transparent resize-none text-sm text-white/80 leading-relaxed
                   px-4 py-4 outline-none placeholder-white/20 font-sans"
      />
      <div className="flex items-center justify-end px-4 py-2 border-t border-white/6 shrink-0">
        <span className={`text-xs tabular-nums ${overLimit ? 'text-red-400 font-semibold' : 'text-white/25'}`}>
          {text.length.toLocaleString()} / {MAX_CHARS.toLocaleString()}
        </span>
      </div>
    </div>
  )
}

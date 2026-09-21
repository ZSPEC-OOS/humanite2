'use client'
import { useMemo } from 'react'
import { diffWords } from 'diff'

interface InlineDiffProps {
  original: string
  rewritten: string
}

export function InlineDiff({ original, rewritten }: InlineDiffProps) {
  const parts = useMemo(() => diffWords(original, rewritten), [original, rewritten])

  return (
    <p className="text-sm leading-relaxed font-mono whitespace-pre-wrap text-white/70">
      {parts.map((part, i) => {
        if (part.added) {
          return (
            <mark key={i} className="bg-green-500/20 text-green-300 rounded-sm px-0.5">
              {part.value}
            </mark>
          )
        }
        if (part.removed) {
          return (
            <del key={i} className="bg-red-500/20 text-red-400 line-through rounded-sm px-0.5">
              {part.value}
            </del>
          )
        }
        return <span key={i}>{part.value}</span>
      })}
    </p>
  )
}

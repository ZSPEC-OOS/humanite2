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
    <p className="text-sm leading-relaxed font-mono whitespace-pre-wrap text-gray-700">
      {parts.map((part, i) => {
        if (part.added) {
          return (
            <mark key={i} className="bg-green-100 text-green-800 rounded-sm px-0.5">
              {part.value}
            </mark>
          )
        }
        if (part.removed) {
          return (
            <del key={i} className="bg-red-100 text-red-700 line-through rounded-sm px-0.5">
              {part.value}
            </del>
          )
        }
        return <span key={i}>{part.value}</span>
      })}
    </p>
  )
}

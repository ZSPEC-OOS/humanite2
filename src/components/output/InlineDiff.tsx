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
    <p className="text-sm leading-relaxed font-mono whitespace-pre-wrap text-gray-700 dark:text-gray-300">
      {parts.map((part, i) => {
        if (part.added) {
          return (
            <mark key={i} className="bg-gray-200 text-gray-900 underline decoration-2 rounded-sm px-0.5 dark:bg-gray-700 dark:text-gray-100">
              {part.value}
            </mark>
          )
        }
        if (part.removed) {
          return (
            <del key={i} className="bg-gray-50 text-gray-500 line-through rounded-sm px-0.5 dark:bg-gray-800 dark:text-gray-500">
              {part.value}
            </del>
          )
        }
        return <span key={i}>{part.value}</span>
      })}
    </p>
  )
}

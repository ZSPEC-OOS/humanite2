import type { FactLock } from './preprocess'

type SubstitutionRule = [RegExp, string]

const RULES: SubstitutionRule[] = [
  [/\butilize[sd]?\b/gi, 'use'],
  [/\butilizing\b/gi, 'using'],
  [/\bdelve[sd]?\b/gi, 'explore'],
  [/\bdelving\b/gi, 'exploring'],
  [/\brobust\b/gi, 'strong'],
  [/\bmultifaceted\b/gi, 'complex'],
  [/\bfacilitate[sd]?\b/gi, 'enable'],
  [/\bfacilitating\b/gi, 'enabling'],
  [/^Furthermore,\s+/gim, ''],
  [/^Moreover,\s+/gim, ''],
  [/^Additionally,\s+/gim, ''],
  [/^In conclusion,\s+/gim, ''],
  [/\bIt is important to note that\b/gi, ''],
]

export function postprocess(text: string, factLocks: FactLock[]): { text: string; substitutions: number } {
  const lockedRanges = factLocks.map(l => [l.char_start, l.char_end] as [number, number])

  function insideLock(start: number, end: number) {
    return lockedRanges.some(([ls, le]) => ls <= start && end <= le)
  }

  let result = text
  let substitutions = 0

  for (const [pattern, replacement] of RULES) {
    // Reset lastIndex for global regexes
    pattern.lastIndex = 0
    let match: RegExpExecArray | null
    const parts: string[] = []
    let lastIndex = 0

    while ((match = pattern.exec(result)) !== null) {
      if (insideLock(match.index, match.index + match[0].length)) {
        parts.push(result.slice(lastIndex, match.index + match[0].length))
        lastIndex = match.index + match[0].length
        continue
      }
      parts.push(result.slice(lastIndex, match.index))
      parts.push(replacement)
      lastIndex = match.index + match[0].length
      substitutions++
    }
    parts.push(result.slice(lastIndex))
    result = parts.join('')
    pattern.lastIndex = 0
  }

  return { text: result.trim(), substitutions }
}

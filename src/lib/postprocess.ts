import type { FactLock } from './preprocess'

type SubstitutionRule = [RegExp, string]

// Deliberately limited to removing AI-typical filler that carries no
// content of its own — never a word-for-word synonym swap. A blind regex
// has no way to tell a defined technical term from generic filler (e.g.
// "robust" has a specific meaning in an engineering spec that "strong"
// doesn't carry), so that class of substitution is left to the model,
// which can see the whole sentence and use judgment — see the STYLE
// GUIDANCE section of buildUserPrompt in humanizePipeline.ts.
const RULES: SubstitutionRule[] = [
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

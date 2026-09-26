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

// A FactLock's char_start/char_end refer to the source chunk it was found
// in — not the model's rewritten output, which is a different string of a
// different length. Locating each lock by content in `text` instead (the
// same occurrence-counting approach qualityGates.ts's checkEntityOverlap
// uses) finds where it actually landed, or correctly finds nothing if the
// rewrite dropped it. Same-text repeats each get their own occurrence via a
// per-text search cursor, so three copies of "2024" resolve to three
// distinct spans rather than all pointing at the first one.
function locateLockRanges(text: string, factLocks: FactLock[]): [number, number][] {
  const ranges: [number, number][] = []
  const searchFrom = new Map<string, number>()
  for (const lock of factLocks) {
    if (!lock.text) continue
    const from = searchFrom.get(lock.text) ?? 0
    const idx = text.indexOf(lock.text, from)
    if (idx === -1) continue
    ranges.push([idx, idx + lock.text.length])
    searchFrom.set(lock.text, idx + lock.text.length)
  }
  return ranges
}

export function postprocess(text: string, factLocks: FactLock[]): { text: string; substitutions: number } {
  function insideLock(lockedRanges: [number, number][], start: number, end: number) {
    return lockedRanges.some(([ls, le]) => ls <= start && end <= le)
  }

  let result = text
  let substitutions = 0

  for (const [pattern, replacement] of RULES) {
    // Recomputed every iteration, not once upfront — an earlier rule in this
    // same loop can shift every character position that follows it (e.g.
    // removing "Furthermore, " moves everything after it left), so a lock
    // range located against an already-modified `result` under stale
    // positions from the original `text` would silently miss its target.
    const lockedRanges = locateLockRanges(result, factLocks)
    // Reset lastIndex for global regexes
    pattern.lastIndex = 0
    let match: RegExpExecArray | null
    const parts: string[] = []
    let lastIndex = 0

    while ((match = pattern.exec(result)) !== null) {
      if (insideLock(lockedRanges, match.index, match.index + match[0].length)) {
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

  result = collapseDoubleSpaces(result, factLocks)
  result = recapitalizeSentenceStarts(result, factLocks)

  return { text: result.trim(), substitutions }
}

// A removed opener ("Furthermore, ") or mid-sentence filler ("it is
// important to note that ") leaves behind whatever whitespace bordered it on
// both sides — when the deleted span sat between two spaces, that's a
// leftover double space. Collapsed everywhere except inside a fact-locked
// span, so a lock's own text (which qualityGates.ts's entity-overlap check
// matches verbatim) is never altered by this cleanup pass.
function collapseDoubleSpaces(text: string, factLocks: FactLock[]): string {
  const lockedRanges = locateLockRanges(text, factLocks)
  return text.replace(/ {2,}/g, (match, offset: number) =>
    insideLock(lockedRanges, offset, offset + match.length) ? match : ' ',
  )

  function insideLock(ranges: [number, number][], start: number, end: number) {
    return ranges.some(([ls, le]) => ls <= start && end <= le)
  }
}

// An opener rule removes its own capital letter along with the punctuation
// after it ("Furthermore, the results…" → "the results…") — the sentence
// that now starts the line, or follows a period, is left lowercase.
// Restricted to true sentence-initial positions (start of text, start of
// line, or right after a ".", "!", or "?") so this never touches a
// deliberately lowercase word appearing mid-sentence, and never touches a
// fact-locked span (a locked quotation may legitimately start lowercase,
// and altering it would break the verbatim-preservation guarantee).
function recapitalizeSentenceStarts(text: string, factLocks: FactLock[]): string {
  const lockedRanges = locateLockRanges(text, factLocks)
  const SENTENCE_START_RE = /(^\s*|[.!?]\s+|\n\s*)([a-z])/g
  return text.replace(SENTENCE_START_RE, (match, prefix: string, letter: string, offset: number) => {
    const letterOffset = offset + prefix.length
    if (lockedRanges.some(([ls, le]) => ls <= letterOffset && letterOffset < le)) return match
    return prefix + letter.toUpperCase()
  })
}

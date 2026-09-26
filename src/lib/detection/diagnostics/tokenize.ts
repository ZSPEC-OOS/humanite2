// Shared low-level tokenization for every diagnostics module — deliberately
// simple regex splitting rather than a real NLP pipeline, since these feed
// descriptive writing statistics, not a classifier (see contracts.ts's
// LocalDiagnostics comment: never combined into an AI-probability of our
// own).

// A lone "." with a digit immediately before AND immediately after (a
// decimal point, "3.4") is never a sentence boundary — distinguished from a
// genuine terminator by what follows it: a real sentence-ending period is
// followed by whitespace, closing punctuation, or the end of the text,
// while a decimal point is followed immediately by another digit. Runs of
// terminator characters ("...", "?!") are never decimal points and always
// treated as a boundary.
const TERMINATOR_RE = /[.!?]+/g

export function splitSentences(text: string): string[] {
  const trimmed = text.trim()
  if (!trimmed) return []

  const sentences: string[] = []
  let start = 0
  let match: RegExpExecArray | null
  TERMINATOR_RE.lastIndex = 0
  while ((match = TERMINATOR_RE.exec(trimmed)) !== null) {
    const terminator = match[0]
    const end = match.index + terminator.length
    const isDecimalPoint =
      terminator === '.' && /\d/.test(trimmed[match.index - 1] ?? '') && /\d/.test(trimmed[end] ?? '')
    if (isDecimalPoint) continue
    sentences.push(trimmed.slice(start, end))
    start = end
  }
  if (start < trimmed.length) sentences.push(trimmed.slice(start))

  return sentences.map(s => s.trim()).filter(Boolean)
}

export function splitParagraphs(text: string): string[] {
  return text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean)
}

export function tokenizeWords(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9']+/g) ?? []
}

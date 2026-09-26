// Shared sentence-splicing primitive — used by every targeted, sentence-
// level repair mechanism (evaluation/repair.ts's fact repair, claims/repair.ts's
// relation repair) so a fix for one sentence can be dropped back into a
// larger text without disturbing anything outside that sentence's exact span.

// Finds each sentence's exact character span in `text` by searching forward
// from the end of the previous span — `sentences` must come from
// splitSentences(text), so each is a verbatim (trim-only) substring of
// `text` in order, letting a repaired sentence be spliced back in without
// disturbing whitespace/formatting the split step itself discarded.
export function locateSentenceSpans(text: string, sentences: string[]): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = []
  let searchFrom = 0
  for (const sentence of sentences) {
    const start = text.indexOf(sentence, searchFrom)
    if (start === -1) {
      spans.push({ start: searchFrom, end: searchFrom })
      continue
    }
    const end = start + sentence.length
    spans.push({ start, end })
    searchFrom = end
  }
  return spans
}

// Replaces the spans named in `replacements` (by index into `spans`) and
// carries every other span's original text through untouched, including the
// whitespace/formatting between spans.
export function spliceSentences(text: string, spans: Array<{ start: number; end: number }>, replacements: Map<number, string>): string {
  let result = ''
  let cursor = 0
  spans.forEach((span, index) => {
    const replacement = replacements.get(index)
    if (replacement == null) return
    result += text.slice(cursor, span.start) + replacement
    cursor = span.end
  })
  result += text.slice(cursor)
  return result
}

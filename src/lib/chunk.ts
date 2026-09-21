import type { FactLock } from './preprocess'

interface Segment {
  text: string
  start: number
  end: number
}

interface Range {
  start: number
  end: number
}

function splitSegments(text: string, re: RegExp): Segment[] {
  const segments: Segment[] = []
  let lastEnd = 0
  let match: RegExpExecArray | null
  re.lastIndex = 0
  while ((match = re.exec(text)) !== null) {
    const end = match.index
    if (end > lastEnd) segments.push({ text: text.slice(lastEnd, end), start: lastEnd, end })
    lastEnd = match.index + match[0].length
    if (match[0].length === 0) re.lastIndex++ // guard against zero-width matches looping forever
  }
  if (lastEnd < text.length) segments.push({ text: text.slice(lastEnd), start: lastEnd, end: text.length })
  return segments
}

// Packs adjacent segments into ranges no larger than maxChars. The separator
// between two segments (a paragraph break or a sentence space — never part
// of either segment's own text) is excluded from both sides rather than
// assigned to one: ranges cover every content character exactly once and
// never overshoot maxChars, at the cost of not being byte-contiguous across
// the original text (that's fine — chunks are reassembled by the caller
// after humanization, not by re-concatenating the source).
function packSegments(segments: Segment[], maxChars: number): Range[] {
  const packed: Range[] = []
  let curStart: number | null = null
  let curEnd = 0
  for (const seg of segments) {
    if (curStart === null) {
      curStart = seg.start
      curEnd = seg.end
      continue
    }
    if (seg.end - curStart <= maxChars) {
      curEnd = seg.end
    } else {
      packed.push({ start: curStart, end: curEnd })
      curStart = seg.start
      curEnd = seg.end
    }
  }
  if (curStart !== null) packed.push({ start: curStart, end: curEnd })
  return packed
}

// Splits `text` into ranges no larger than `maxChars`, preferring paragraph
// boundaries, falling back to sentence boundaries for an oversized paragraph,
// and finally a hard character split for a single "sentence" with no
// punctuation at all (e.g. a wall of numbers). Ranges are non-overlapping,
// in order, and never exceed maxChars; every non-whitespace character of
// `text` appears in exactly one range (only the separator whitespace between
// ranges may be excluded).
export function chunkRanges(text: string, maxChars: number): Range[] {
  if (text.length === 0) return []
  if (text.length <= maxChars) return [{ start: 0, end: text.length }]

  const paragraphs = splitSegments(text, /\n\n+/g)
  const paragraphRanges = packSegments(paragraphs, maxChars)

  const result: Range[] = []
  for (const r of paragraphRanges) {
    if (r.end - r.start <= maxChars) {
      result.push(r)
      continue
    }
    const sub = text.slice(r.start, r.end)
    const sentences = splitSegments(sub, /(?<=[.!?])\s+/g)
    const sentenceRanges = packSegments(sentences, maxChars).map(sr => ({
      start: r.start + sr.start,
      end: r.start + sr.end,
    }))
    for (const sr of sentenceRanges) {
      if (sr.end - sr.start <= maxChars) {
        result.push(sr)
        continue
      }
      for (let i = sr.start; i < sr.end; i += maxChars) {
        result.push({ start: i, end: Math.min(i + maxChars, sr.end) })
      }
    }
  }
  return result
}

export interface TextChunk {
  text: string
  factLocks: FactLock[]
}

// Fact locks that straddle a chunk boundary (rare — locks are short spans;
// this only happens if a split lands inside one) are dropped from both
// sides rather than partially enforced. Chunking on paragraph/sentence
// boundaries makes this edge case unlikely in practice.
export function chunkFactLockedText(
  sanitizedText: string,
  factLocks: FactLock[],
  maxChars: number,
): TextChunk[] {
  return chunkRanges(sanitizedText, maxChars).map(({ start, end }) => ({
    text: sanitizedText.slice(start, end),
    factLocks: factLocks
      .filter(l => l.char_start >= start && l.char_end <= end)
      .map(l => ({ ...l, char_start: l.char_start - start, char_end: l.char_end - start })),
  }))
}

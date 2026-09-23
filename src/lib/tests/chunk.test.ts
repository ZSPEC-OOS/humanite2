import { describe, it, expect } from 'vitest'
import { chunkRanges, chunkFactLockedText } from '../chunk'
import { preprocess } from '../preprocess'
import type { FactLock } from '../preprocess'

function lock(text: string, char_start: number): FactLock {
  return { char_start, char_end: char_start + text.length, text, lock_type: 'number', label: 'NUM' }
}

describe('chunkRanges', () => {
  it('returns a single range for text under the limit', () => {
    const ranges = chunkRanges('short text', 100)
    expect(ranges).toEqual([{ start: 0, end: 10 }])
  })

  it('returns an empty array for empty text', () => {
    expect(chunkRanges('', 100)).toEqual([])
  })

  it('splits on paragraph boundaries when over the limit', () => {
    const text = 'a'.repeat(50) + '\n\n' + 'b'.repeat(50) + '\n\n' + 'c'.repeat(50)
    const ranges = chunkRanges(text, 60)
    expect(ranges.length).toBeGreaterThan(1)
    // every range must be within the limit, in order, non-overlapping
    let prevEnd = 0
    for (const r of ranges) {
      expect(r.end - r.start).toBeLessThanOrEqual(60)
      expect(r.start).toBeGreaterThanOrEqual(prevEnd)
      prevEnd = r.end
    }
    expect(prevEnd).toBeLessThanOrEqual(text.length)
  })

  it('packs multiple short paragraphs into one chunk when they fit', () => {
    const text = 'one\n\ntwo\n\nthree'
    const ranges = chunkRanges(text, 100)
    expect(ranges).toEqual([{ start: 0, end: text.length }])
  })

  it('falls back to sentence splitting for an oversized single paragraph', () => {
    const sentence = 'This is a reasonably long sentence about nothing in particular. '
    const text = sentence.repeat(10) // one "paragraph", no \n\n, way over the limit
    const ranges = chunkRanges(text, 200)
    expect(ranges.length).toBeGreaterThan(1)
    for (const r of ranges) {
      expect(r.end - r.start).toBeLessThanOrEqual(200)
    }
  })

  it('falls back to a hard character split when there is no punctuation at all', () => {
    const text = '1234567890'.repeat(30) // 300 chars, no sentence or paragraph boundaries
    const ranges = chunkRanges(text, 100)
    expect(ranges.every(r => r.end - r.start <= 100)).toBe(true)
    // still exhaustive and contiguous
    expect(ranges[0]!.start).toBe(0)
    expect(ranges.at(-1)!.end).toBe(text.length)
  })

  it('never drops or duplicates a content character across a long, mixed document', () => {
    const text = ('Paragraph one is short.\n\n' + 'Sentence. '.repeat(40) + '\n\n' + 'x'.repeat(500))
    const ranges = chunkRanges(text, 150)

    // ranges are ordered and non-overlapping
    let prevEnd = 0
    for (const r of ranges) {
      expect(r.start).toBeGreaterThanOrEqual(prevEnd)
      expect(r.end - r.start).toBeLessThanOrEqual(150)
      prevEnd = r.end
    }

    // no non-whitespace character was dropped or duplicated
    const reassembled = ranges.map(r => text.slice(r.start, r.end)).join('')
    expect(reassembled.replace(/\s+/g, '')).toBe(text.replace(/\s+/g, ''))
  })
})

describe('chunkFactLockedText', () => {
  it('keeps a single chunk with all fact locks untouched when text fits', () => {
    const text = 'Revenue grew by 12% in 2023.'
    const locks = [lock('12%', 16), lock('2023', 24)]
    const chunks = chunkFactLockedText(text, locks, 100)
    expect(chunks).toHaveLength(1)
    expect(chunks[0]!.text).toBe(text)
    expect(chunks[0]!.factLocks).toEqual(locks)
  })

  it('remaps fact lock offsets to be relative to each chunk', () => {
    const para1 = 'Alpha had 12% growth.'
    const para2 = 'Beta had 8% growth.'
    const text = `${para1}\n\n${para2}`
    const locks = [lock('12%', para1.indexOf('12%')), lock('8%', text.indexOf('8%'))]

    const chunks = chunkFactLockedText(text, locks, para1.length) // forces a split between paragraphs

    expect(chunks).toHaveLength(2)
    expect(chunks[0]!.text).toBe(para1)
    expect(chunks[0]!.factLocks).toHaveLength(1)
    const firstLock = chunks[0]!.factLocks[0]!
    expect(chunks[0]!.text.slice(firstLock.char_start, firstLock.char_end)).toBe('12%')

    expect(chunks[1]!.text).toBe(para2)
    expect(chunks[1]!.factLocks).toHaveLength(1)
    const secondLock = chunks[1]!.factLocks[0]!
    expect(chunks[1]!.text.slice(secondLock.char_start, secondLock.char_end)).toBe('8%')
  })

  it('never bisects a fact lock, even when the natural split point falls inside it', () => {
    const text = 'a'.repeat(10) + '12%' + 'b'.repeat(10) // "12%" straddles offset 10-13
    const locks = [lock('12%', 10)]
    // Without lock-awareness this would hard-split right through "12%" at
    // offset 11 (maxChars=11) — the boundary must move instead.
    const chunks = chunkFactLockedText(text, locks, 11)
    const allLocks = chunks.flatMap(c => c.factLocks)
    expect(allLocks).toHaveLength(1)
    // The lock's local offsets in whichever chunk it landed in must still
    // resolve to its exact original text — not just "a lock survived".
    const owner = chunks.find(c => c.factLocks.length > 0)!
    const survivingLock = owner.factLocks[0]!
    expect(owner.text.slice(survivingLock.char_start, survivingLock.char_end)).toBe('12%')
  })

  it('may exceed maxChars slightly rather than drop a straddling lock', () => {
    const text = 'a'.repeat(10) + '12%' + 'b'.repeat(10)
    const locks = [lock('12%', 10)]
    const chunks = chunkFactLockedText(text, locks, 11)
    // The chunk absorbing the lock is allowed to grow past maxChars=11 —
    // the alternative (silently losing the fact) is worse.
    expect(chunks.some(c => c.text.length > 11)).toBe(true)
    expect(chunks.flatMap(c => c.factLocks)).toHaveLength(1)
  })

  it('a lock straddling several consecutive hard-split points in a row is still fully absorbed', () => {
    const text = 'x'.repeat(5) + '1234567890' + 'y'.repeat(5) // a 10-char lock, tiny maxChars
    const locks = [lock('1234567890', 5)]
    const chunks = chunkFactLockedText(text, locks, 3) // would otherwise split every 3 chars
    const allLocks = chunks.flatMap(c => c.factLocks)
    expect(allLocks).toHaveLength(1)
    const owner = chunks.find(c => c.factLocks.length > 0)!
    const survivingLock = owner.factLocks[0]!
    expect(owner.text.slice(survivingLock.char_start, survivingLock.char_end)).toBe('1234567890')
  })

  it('a citation like "et al. (2024)" is not bisected by the sentence-boundary splitter', () => {
    // CITATION_RE matches "et al. (2024)" as one lock, but its own internal
    // ". " looks exactly like a sentence boundary to chunkRanges — a real
    // collision between two regexes in this codebase, not a hypothetical.
    const before = 'Prior findings were limited. '.repeat(3)
    const text = `${before}This replicates work by et al. (2024) in the field. ` + 'More text follows here. '.repeat(3)
    const { sanitized_text, fact_locks } = preprocess(text)
    const citationLock = fact_locks.find(l => l.lock_type === 'citation')
    expect(citationLock).toBeDefined()

    // maxChars chosen so a naive sentence split would land inside "et al. (2024)".
    const splitPoint = sanitized_text.indexOf('et al.') + 'et al.'.length + 1
    const chunks = chunkFactLockedText(sanitized_text, fact_locks, splitPoint)

    const owner = chunks.find(c => c.factLocks.some(l => l.lock_type === 'citation'))
    expect(owner).toBeDefined()
    const survivingLock = owner!.factLocks.find(l => l.lock_type === 'citation')!
    expect(owner!.text.slice(survivingLock.char_start, survivingLock.char_end)).toBe(citationLock!.text)
  })

  it('chunk texts together cover every content character exactly once', () => {
    const text = 'Para one here.\n\n' + 'Sentence one. Sentence two. Sentence three. '.repeat(5) + '\n\nFinal para.'
    const chunks = chunkFactLockedText(text, [], 80)
    const reassembled = chunks.map(c => c.text).join('')
    expect(reassembled.replace(/\s+/g, '')).toBe(text.replace(/\s+/g, ''))
  })

  it('records the real separator between chunks, reproducing the source exactly when rejoined', () => {
    const text = 'Para one here.\n\n' + 'Sentence one. Sentence two. Sentence three. '.repeat(5) + '\n\nFinal para.'
    const chunks = chunkFactLockedText(text, [], 80)
    expect(chunks.length).toBeGreaterThan(1)
    const reassembled = chunks.map(c => c.text + c.separatorAfter).join('')
    expect(reassembled).toBe(text)
  })

  it('the last chunk has no trailing separator', () => {
    const text = 'Para one here.\n\n' + 'Sentence one. Sentence two. Sentence three. '.repeat(5) + '\n\nFinal para.'
    const chunks = chunkFactLockedText(text, [], 80)
    expect(chunks.at(-1)!.separatorAfter).toBe('')
  })

  it('a sentence-split oversized paragraph records a single space as its separator, not a paragraph break', () => {
    const sentence = 'This is a reasonably long sentence about nothing in particular. '
    // .trimEnd() mirrors preprocess()'s own trim() — sanitizedText reaching
    // the real chunker never has trailing separator whitespace to lose.
    const text = sentence.repeat(10).trimEnd() // one paragraph, no \n\n at all
    const chunks = chunkFactLockedText(text, [], 200)
    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks.slice(0, -1)) {
      expect(c.separatorAfter).not.toContain('\n\n')
    }
    expect(chunks.map(c => c.text + c.separatorAfter).join('')).toBe(text)
  })
})

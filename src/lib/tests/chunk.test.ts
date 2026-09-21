import { describe, it, expect } from 'vitest'
import { chunkRanges, chunkFactLockedText } from '../chunk'
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

  it('drops a fact lock that straddles a chunk boundary rather than corrupting it', () => {
    const text = 'a'.repeat(10) + '12%' + 'b'.repeat(10) // "12%" straddles offset 10-13
    const locks = [lock('12%', 10)]
    // Force a split in the middle of the fact lock.
    const chunks = chunkFactLockedText(text, locks, 11)
    const allLocks = chunks.flatMap(c => c.factLocks)
    expect(allLocks).toHaveLength(0)
  })

  it('chunk texts together cover every content character exactly once', () => {
    const text = 'Para one here.\n\n' + 'Sentence one. Sentence two. Sentence three. '.repeat(5) + '\n\nFinal para.'
    const chunks = chunkFactLockedText(text, [], 80)
    const reassembled = chunks.map(c => c.text).join('')
    expect(reassembled.replace(/\s+/g, '')).toBe(text.replace(/\s+/g, ''))
  })
})

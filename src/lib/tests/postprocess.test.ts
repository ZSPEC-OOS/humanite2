import { describe, it, expect } from 'vitest'
import { postprocess } from '../postprocess'
import type { FactLock } from '../preprocess'

describe('postprocess — no longer performs synonym substitution', () => {
  it('leaves "utilize", "delve", "robust", "multifaceted", "facilitate" untouched', () => {
    const text = 'We utilize a robust, multifaceted approach to facilitate delving into the data.'
    const { text: result, substitutions } = postprocess(text, [])
    expect(result).toBe(text)
    expect(substitutions).toBe(0)
  })

  it('does not alter a domain-specific use of "robust" (the exact case a blind regex could not tell apart)', () => {
    const text = 'The bridge design meets the robust load-bearing standard specified in the engineering code.'
    const { text: result } = postprocess(text, [])
    expect(result).toBe(text)
  })
})

describe('postprocess — still removes AI-typical filler openers', () => {
  it('removes a "Furthermore," sentence opener', () => {
    const { text, substitutions } = postprocess('Furthermore, the results were consistent.', [])
    expect(text).toBe('the results were consistent.')
    expect(substitutions).toBe(1)
  })

  it('removes "Moreover," and "Additionally," openers', () => {
    expect(postprocess('Moreover, this held true.', []).text).toBe('this held true.')
    expect(postprocess('Additionally, costs fell.', []).text).toBe('costs fell.')
  })

  it('removes "In conclusion," and "It is important to note that"', () => {
    expect(postprocess('In conclusion, the study succeeded.', []).text).toBe('the study succeeded.')
    expect(postprocess('It is important to note that results vary.', []).text).toBe('results vary.')
  })

  it('does not remove "Furthermore" mid-sentence (opener pattern is anchored to line start)', () => {
    const text = 'The paper goes Furthermore into detail on this point.'
    expect(postprocess(text, []).text).toBe(text)
  })
})

describe('postprocess — respects fact locks', () => {
  it('does not touch a filler phrase that falls inside a locked span', () => {
    const text = 'In conclusion, the quote was: "In conclusion, we succeeded."'
    const quoteStart = text.indexOf('"In conclusion')
    const locks: FactLock[] = [
      { char_start: quoteStart, char_end: text.length, text: text.slice(quoteStart), lock_type: 'quotation', label: 'QUOTE' },
    ]
    const { text: result } = postprocess(text, locks)
    // The unlocked opener is removed; the one inside the locked quotation survives.
    expect(result).toBe('the quote was: "In conclusion, we succeeded."')
  })

  it('protects a locked quotation by content even when the model moved it to a new position', () => {
    // This is the actual production shape: factLocks are computed against
    // the ORIGINAL source text, but postprocess() runs against the model's
    // REWRITTEN output — a different string where the locked span is very
    // likely at a different offset. char_start/char_end from the original
    // would be meaningless here; only content-based location works.
    const original = 'The quote was: "In conclusion, we succeeded." That was the summary.'
    const quoteStart = original.indexOf('"In conclusion')
    const lockText = original.slice(quoteStart, quoteStart + '"In conclusion, we succeeded."'.length)
    const locks: FactLock[] = [
      { char_start: quoteStart, char_end: quoteStart + lockText.length, text: lockText, lock_type: 'quotation', label: 'QUOTE' },
    ]

    // The model reordered the sentences — the quote now sits much later.
    const rewritten = 'That was the summary. The quote was: "In conclusion, we succeeded."'
    const { text: result } = postprocess(rewritten, locks)
    expect(result).toBe(rewritten) // opener inside the quote must survive untouched
  })

  it('assigns repeated identical locked text to distinct occurrences in the rewrite', () => {
    const locks: FactLock[] = [
      { char_start: 0, char_end: 4, text: '2024', lock_type: 'date', label: 'DATE' },
      { char_start: 50, char_end: 54, text: '2024', lock_type: 'date', label: 'DATE' },
    ]
    // Neither occurrence contains filler text, so this just proves the
    // function does not throw or misbehave when the same value repeats —
    // covered more directly by the entity-overlap occurrence tests.
    const rewritten = 'Filed in 2024, revised again in 2024 as planned.'
    const { text: result } = postprocess(rewritten, locks)
    expect(result).toBe(rewritten)
  })
})

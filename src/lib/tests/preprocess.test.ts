import { describe, it, expect } from 'vitest'
import { preprocess } from '../preprocess'
import type { FactLockType } from '../preprocess'

function locksOfType(text: string, type: FactLockType) {
  return preprocess(text).fact_locks.filter(l => l.lock_type === type)
}

describe('preprocess — sanitization', () => {
  it('strips zero-width characters', () => {
    const result = preprocess('hello​world')
    expect(result.sanitized_text).toBe('helloworld')
  })

  it('strips HTML-like tags', () => {
    const result = preprocess('some <b>bold</b> text')
    expect(result.sanitized_text).toBe('some bold text')
  })

  it('collapses excess spaces and blank lines', () => {
    const result = preprocess('a    b\n\n\n\nc')
    expect(result.sanitized_text).toBe('a b\n\nc')
  })

  it('trims leading/trailing whitespace and reports word/char counts', () => {
    const result = preprocess('  two words  ')
    expect(result.sanitized_text).toBe('two words')
    expect(result.word_count).toBe(2)
    expect(result.char_count).toBe('two words'.length)
  })
})

describe('preprocess — number/citation/date locks (pre-existing categories)', () => {
  it('locks a bare number', () => {
    const locks = locksOfType('Revenue grew by 12 percent.', 'number')
    expect(locks.map(l => l.text)).toEqual(['12'])
  })

  it('locks a number with a recognized unit suffix', () => {
    const locks = locksOfType('The room is 12 m wide.', 'number')
    expect(locks.map(l => l.text)).toEqual(['12 m'])
  })

  it('locks bracketed and author-year citations', () => {
    const text = 'This replicates prior work [12] and (Smith, 2024).'
    const locks = locksOfType(text, 'citation')
    expect(locks.map(l => l.text)).toEqual(['[12]', '(Smith, 2024)'])
  })

  it('locks ISO and written-out dates', () => {
    const text = 'Filed on 2024-01-05, discussed again January 5, 2024.'
    const locks = locksOfType(text, 'date')
    expect(locks.map(l => l.text)).toEqual(['2024-01-05', 'January 5, 2024'])
  })
})

describe('preprocess — quotation locks', () => {
  it('locks a straight-quoted passage as one span', () => {
    const text = 'She said "this changes everything" during the call.'
    const locks = locksOfType(text, 'quotation')
    expect(locks).toHaveLength(1)
    expect(locks[0]!.text).toBe('"this changes everything"')
    expect(locks[0]!.char_start).toBe(text.indexOf('"this'))
  })

  it('locks a curly-quoted passage', () => {
    const text = 'She said “this changes everything” during the call.'
    const locks = locksOfType(text, 'quotation')
    expect(locks).toHaveLength(1)
    expect(locks[0]!.text).toBe('“this changes everything”')
  })

  it('quotations take priority over overlapping number/proper-noun matches inside them', () => {
    const text = 'He wrote "New York had 12 inches of snow" in his diary.'
    const result = preprocess(text)
    const quote = result.fact_locks.find(l => l.lock_type === 'quotation')
    expect(quote?.text).toBe('"New York had 12 inches of snow"')
    // Nothing else should have claimed a span inside the quote.
    const nested = result.fact_locks.filter(
      l => l.lock_type !== 'quotation' && l.char_start >= quote!.char_start && l.char_end <= quote!.char_end,
    )
    expect(nested).toHaveLength(0)
  })
})

describe('preprocess — url locks', () => {
  it('locks an https URL', () => {
    const locks = locksOfType('See https://example.com/path?q=1 for details.', 'url')
    expect(locks.map(l => l.text)).toEqual(['https://example.com/path?q=1'])
  })

  it('locks a bare www URL', () => {
    const locks = locksOfType('Visit www.example.com today.', 'url')
    expect(locks.map(l => l.text)).toEqual(['www.example.com'])
  })

  it('does not swallow trailing punctuation or a closing paren', () => {
    const locks = locksOfType('(see https://example.com/a).', 'url')
    expect(locks.map(l => l.text)).toEqual(['https://example.com/a'])
  })
})

describe('preprocess — equation locks', () => {
  it('locks dollar-delimited LaTeX', () => {
    const locks = locksOfType('The identity $E = mc^2$ is well known.', 'equation')
    expect(locks.map(l => l.text)).toEqual(['$E = mc^2$'])
  })

  it('locks \\(...\\) and \\[...\\] delimited LaTeX', () => {
    const text = 'Inline \\(a^2 + b^2 = c^2\\) and display \\[x = y\\] forms.'
    const locks = locksOfType(text, 'equation')
    expect(locks.map(l => l.text)).toEqual(['\\(a^2 + b^2 = c^2\\)', '\\[x = y\\]'])
  })

  it('does not treat plain prose as an equation', () => {
    const locks = locksOfType('The price was $12 for the item.', 'equation')
    expect(locks).toHaveLength(0)
  })
})

describe('preprocess — chemical locks', () => {
  it('locks a simple molecular formula', () => {
    const locks = locksOfType('Water is H2O at room temperature.', 'chemical')
    expect(locks.map(l => l.text)).toContain('H2O')
  })

  it('locks a multi-element formula', () => {
    const locks = locksOfType('Table salt is NaCl.', 'chemical')
    expect(locks.map(l => l.text)).toContain('NaCl')
  })
})

describe('preprocess — proper_noun locks', () => {
  it('locks a two-word Title Case name', () => {
    const locks = locksOfType('New York is a large city.', 'proper_noun')
    expect(locks.map(l => l.text)).toContain('New York')
  })

  it('locks a longer multi-word institution name', () => {
    const locks = locksOfType('The World Health Organization issued guidance.', 'proper_noun')
    expect(locks.map(l => l.text)).toContain('World Health Organization')
  })

  it('excludes a common sentence-initial capitalized word from the match', () => {
    const locks = locksOfType('The United Nations met today.', 'proper_noun')
    expect(locks.map(l => l.text)).toContain('United Nations')
    expect(locks.map(l => l.text)).not.toContain('The United')
  })

  it('does not lock a single capitalized word', () => {
    const locks = locksOfType('Germany exported goods.', 'proper_noun')
    expect(locks).toHaveLength(0)
  })

  it('does not lock a Title Case heading or sentence fragment as a proper noun', () => {
    const locks = locksOfType('Overall Results Were Mixed across the three cohorts.', 'proper_noun')
    expect(locks.map(l => l.text)).not.toContain('Overall Results Were Mixed')
  })

  it('still locks a genuine multi-word proper noun that happens to sit near heading-like text', () => {
    const text = 'Summary And Discussion: the World Health Organization issued new guidance.'
    const locks = locksOfType(text, 'proper_noun')
    expect(locks.map(l => l.text)).toContain('World Health Organization')
    expect(locks.map(l => l.text)).not.toContain('Summary And Discussion')
  })
})

describe('preprocess — overlap resolution across categories', () => {
  it('never produces two locks that share a character', () => {
    const text = 'On January 5, 2024, Dr. Jane Smith cited [3] a figure of 45% from https://example.com and wrote "the result was $E=mc^2$ exactly" about NaCl.'
    const { fact_locks } = preprocess(text)
    const sorted = [...fact_locks].sort((a, b) => a.char_start - b.char_start)
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]!.char_start).toBeGreaterThanOrEqual(sorted[i - 1]!.char_end)
    }
  })

  it('every lock text matches the sanitized text at its recorded offsets', () => {
    const text = 'Filed 2024-01-05 by New York City for [7], worth $4.2M, see www.example.com.'
    const { sanitized_text, fact_locks } = preprocess(text)
    for (const lock of fact_locks) {
      expect(sanitized_text.slice(lock.char_start, lock.char_end)).toBe(lock.text)
    }
  })
})

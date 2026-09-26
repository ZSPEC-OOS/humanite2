import { describe, it, expect } from 'vitest'
import { buildFactLedger } from '../factLedger'
import { validateFactLedger } from '../validator'

describe('buildFactLedger', () => {
  it('tags every fact with the source sentence index it came from', () => {
    const facts = buildFactLedger('The dose is 5 mg. The trial had 40 patients.')
    const bySentence = new Map<number, number>()
    for (const fact of facts) bySentence.set(fact.sentenceIndex, (bySentence.get(fact.sentenceIndex) ?? 0) + 1)
    expect(bySentence.get(0)).toBeGreaterThan(0)
    expect(bySentence.get(1)).toBeGreaterThan(0)
  })

  it('returns no facts for text with nothing to extract', () => {
    expect(buildFactLedger('This sentence has nothing notable in it.')).toEqual([])
  })
})

describe('validateFactLedger', () => {
  it('passes when the output is character-for-character identical to the source', () => {
    const text = 'The dose is 5 mg, and it must not exceed 20 mg per day.'
    const result = validateFactLedger(text, text)
    expect(result.passed).toBe(true)
    expect(result.failures).toHaveLength(0)
    expect(result.factCount).toBeGreaterThan(0)
  })

  it('falls back to whole-output search when a sentence has no aligned match (a legitimate split/merge), rather than an automatic failure', () => {
    const source = 'The dose is 5 mg.'
    // Entirely restructured, low word-overlap with the source sentence,
    // but the fact ("5 mg") still genuinely survives in the output text.
    const output = 'Administer 5 mg to the patient as directed by staff.'
    const result = validateFactLedger(source, output)
    expect(result.passed).toBe(true)
  })

  it('still fails when no aligned sentence exists AND the fact is genuinely absent from the whole output', () => {
    const source = 'The dose is 5 mg.'
    const output = 'Administer the standard dose to the patient as directed by staff.'
    const result = validateFactLedger(source, output)
    expect(result.passed).toBe(false)
  })

  it('reports which fact and sentence failed in a human-readable reason', () => {
    const result = validateFactLedger('The results did not increase.', 'The results increased.')
    expect(result.passed).toBe(false)
    expect(result.failures[0]!.fact.type).toBe('negation')
    expect(result.failures[0]!.reason).toContain('negation')
  })
})

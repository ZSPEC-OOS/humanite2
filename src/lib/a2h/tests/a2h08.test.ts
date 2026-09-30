import { describe, it, expect } from 'vitest'
import { computeA2H08Measurements, matchGrammarFindings, aggregateA2H08, type A2H08Measurements } from '../a2h08'
import type { GrammarFinding } from '../types'

function finding(partial: Partial<GrammarFinding> & { ruleId: string; text: string }): GrammarFinding {
  return { category: 'subject_verb_agreement', message: '', start: 0, end: 0, suggestions: [], ...partial }
}

describe('computeA2H08Measurements — §53 acceptance cases', () => {
  it('zero source errors, zero output errors', () => {
    const m = computeA2H08Measurements('The patient recovers quickly.', 'The patient recovers quickly and fully.')
    expect(m.eligible).toBe(true)
    expect(m.sourceErrorCount).toBe(0)
    expect(m.outputErrorCount).toBe(0)
    expect(m.newErrorsPer1000).toBe(0)
    expect(m.zeroNewErrors).toBe(true)
  })

  it('zero source errors, one output error', () => {
    const m = computeA2H08Measurements('The patient recovers quickly.', 'The patient recover quickly.')
    expect(m.sourceErrorCount).toBe(0)
    expect(m.outputErrorCount).toBe(1)
    expect(m.newErrorCount).toBe(1)
    expect(m.newErrorsPer1000).toBeGreaterThan(0)
    expect(m.zeroNewErrors).toBe(false)
  })

  it('a source error resolved (not present in output) is not counted as new', () => {
    const m = computeA2H08Measurements('The patient recover quickly.', 'The patient recovers quickly.')
    expect(m.sourceErrorCount).toBe(1)
    expect(m.outputErrorCount).toBe(0)
    expect(m.resolvedErrorCount).toBe(1)
    expect(m.newErrorCount).toBe(0)
    expect(m.newErrorsPer1000).toBeLessThanOrEqual(0)
  })

  it('a source error retained in the output is not double-counted as new', () => {
    const text = 'The patient recover quickly.'
    const m = computeA2H08Measurements(text, text)
    expect(m.sourceErrorCount).toBe(1)
    expect(m.outputErrorCount).toBe(1)
    expect(m.newErrorCount).toBe(0)
  })

  it('very short source/output text is still eligible', () => {
    const m = computeA2H08Measurements('Yes.', 'No.')
    expect(m.eligible).toBe(true)
  })

  it('empty source or output text is ineligible', () => {
    expect(computeA2H08Measurements('', 'Some output text.').eligible).toBe(false)
    expect(computeA2H08Measurements('Some source text.', '').eligible).toBe(false)
  })

  it('normalizes per 1000 words correctly regardless of document length', () => {
    const longSource = Array(500).fill('word').join(' ') + '.'
    const longOutputWithOneError = Array(500).fill('word').join(' ') + ' and the patient recover quickly.'
    const m = computeA2H08Measurements(longSource, longOutputWithOneError)
    // 1 new error over ~505 words -> roughly 2 per 1000, not close to 1000.
    expect(m.newErrorsPer1000).toBeGreaterThan(0)
    expect(m.newErrorsPer1000).toBeLessThan(10)
  })
})

describe('matchGrammarFindings — §16 matching strategy', () => {
  it('matches a finding whose position moved but ruleId/text are unchanged (moved, not new)', () => {
    const source = [finding({ ruleId: 'SVA_SUBJECT_MISMATCH', text: 'recover', start: 20, end: 27 })]
    const output = [finding({ ruleId: 'SVA_SUBJECT_MISMATCH', text: 'recover', start: 5, end: 12 })]
    const result = matchGrammarFindings(source, output)
    expect(result.retained).toHaveLength(1)
    expect(result.newFindings).toHaveLength(0)
    expect(result.resolved).toHaveLength(0)
  })

  it('does not match findings with different ruleIds even if text matches', () => {
    const source = [finding({ ruleId: 'SVA_SUBJECT_MISMATCH', text: 'foo' })]
    const output = [finding({ ruleId: 'ARTICLE_A_AN', text: 'foo' })]
    const result = matchGrammarFindings(source, output)
    expect(result.resolved).toHaveLength(1)
    expect(result.newFindings).toHaveLength(1)
  })

  it('classifies an unmatched output finding as new', () => {
    const result = matchGrammarFindings([], [finding({ ruleId: 'PUNCTUATION_DOUBLED', text: '??' })])
    expect(result.newFindings).toHaveLength(1)
  })
})

describe('aggregateA2H08', () => {
  it('reports zero/any-new-error counts and per-category new-error totals', () => {
    const measurements: A2H08Measurements[] = [
      { eligible: true, sourceWordCount: 10, outputWordCount: 10, sourceErrorCount: 0, outputErrorCount: 1, sourceErrorsPer1000: 0, outputErrorsPer1000: 100, newErrorsPer1000: 100, newErrorCount: 1, resolvedErrorCount: 0, categoryCountsBefore: {}, categoryCountsAfter: { subject_verb_agreement: 1 }, zeroNewErrors: false },
      { eligible: true, sourceWordCount: 10, outputWordCount: 10, sourceErrorCount: 0, outputErrorCount: 0, sourceErrorsPer1000: 0, outputErrorsPer1000: 0, newErrorsPer1000: 0, newErrorCount: 0, resolvedErrorCount: 0, categoryCountsBefore: {}, categoryCountsAfter: {}, zeroNewErrors: true },
    ]
    const agg = aggregateA2H08(measurements)
    expect(agg.zeroNewErrorsCount).toBe(1)
    expect(agg.anyNewErrorsCount).toBe(1)
    expect(agg.totalNewErrors).toBe(1)
    expect(agg.newErrorsByCategory['subject_verb_agreement']).toBe(1)
  })
})

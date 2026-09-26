import { describe, it, expect } from 'vitest'
import { measureStyleDiagnostics } from '../measure'

describe('measureStyleDiagnostics', () => {
  it('reports a higher hedge_density for text full of epistemic hedges than for flat, unhedged text', () => {
    const hedged = 'The results may suggest a possible link, though the effect appears relatively modest and could potentially vary.'
    const unhedged = 'The results show a clear link. The effect is large and consistent across every trial.'
    expect(measureStyleDiagnostics(hedged).hedge_density).toBeGreaterThan(measureStyleDiagnostics(unhedged).hedge_density)
  })

  it('reports zero hedge_density for text with no hedge words at all', () => {
    expect(measureStyleDiagnostics('The invoice is due on the first of the month.').hedge_density).toBe(0)
  })

  it('still carries every field of the underlying local diagnostics', () => {
    const result = measureStyleDiagnostics('This is a short passage. It has two sentences.')
    expect(result.word_count).toBeGreaterThan(0)
    expect(result.sentence_count).toBe(2)
    expect(typeof result.contraction_rate).toBe('number')
    expect(typeof result.first_person_rate).toBe('number')
    expect(typeof result.average_sentence_length).toBe('number')
  })
})

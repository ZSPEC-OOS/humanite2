import { describe, it, expect } from 'vitest'
import { normalizeGPTZero } from '../normalize'

const TEXT = 'The first sentence is here. The second sentence follows it.'

describe('normalizeGPTZero', () => {
  it('maps the documented HUMAN_ONLY/MIXED/AI_ONLY enum', () => {
    expect(normalizeGPTZero({ document_classification: 'HUMAN_ONLY' }, TEXT).classification).toBe('human-written')
    expect(normalizeGPTZero({ document_classification: 'MIXED' }, TEXT).classification).toBe('mixed')
    expect(normalizeGPTZero({ document_classification: 'AI_ONLY' }, TEXT).classification).toBe('ai-generated')
  })

  it('maps the flat lowercase classification enum from the published OpenAPI schema', () => {
    expect(normalizeGPTZero({ classification: 'human' }, TEXT).classification).toBe('human-written')
    expect(normalizeGPTZero({ classification: 'ai' }, TEXT).classification).toBe('ai-generated')
    expect(normalizeGPTZero({ classification: 'mixed' }, TEXT).classification).toBe('mixed')
  })

  it('falls back to uncertain with a warning on an unrecognized classification', () => {
    const result = normalizeGPTZero({ classification: 'something-new' }, TEXT)
    expect(result.classification).toBe('uncertain')
    expect(result.warnings).toContain('Unrecognized GPTZero classification "something-new".')
  })

  it('falls back to uncertain with a warning when no classification field is present', () => {
    const result = normalizeGPTZero({}, TEXT)
    expect(result.classification).toBe('uncertain')
    expect(result.warnings.length).toBeGreaterThan(0)
  })

  it('unwraps a documents[] envelope the same as a flat response', () => {
    const flat = normalizeGPTZero({ classification: 'ai', class_probabilities: { human: 0.1, ai: 0.9, mixed: 0 } }, TEXT)
    const wrapped = normalizeGPTZero({
      documents: [{ classification: 'ai', class_probabilities: { human: 0.1, ai: 0.9, mixed: 0 } }],
    }, TEXT)
    expect(wrapped.classification).toBe(flat.classification)
    expect(wrapped.probabilities).toEqual(flat.probabilities)
  })

  it('passes through class_probabilities when present', () => {
    const result = normalizeGPTZero(
      { classification: 'ai', class_probabilities: { human: 0.05, ai: 0.9, mixed: 0.05 } },
      TEXT,
    )
    expect(result.probabilities).toEqual({ human: 0.05, ai: 0.9, mixed: 0.05 })
    expect(result.predicted_class_probability).toBe(0.9)
  })

  it('derives probabilities from completely_generated_prob when class_probabilities is absent', () => {
    const result = normalizeGPTZero({ classification: 'ai', completely_generated_prob: 0.87 }, TEXT)
    expect(result.probabilities).toEqual({ human: 0.13, ai: 0.87, mixed: null })
  })

  it('uses the documented confidence_category when present', () => {
    const result = normalizeGPTZero({ classification: 'ai', confidence_category: 'high' }, TEXT)
    expect(result.confidence_category).toBe('high')
  })

  it('derives confidence_category from predicted_class_probability when absent', () => {
    const high = normalizeGPTZero({ classification: 'ai', class_probabilities: { human: 0.1, ai: 0.85, mixed: 0.05 } }, TEXT)
    const low = normalizeGPTZero({ classification: 'ai', class_probabilities: { human: 0.4, ai: 0.5, mixed: 0.1 } }, TEXT)
    expect(high.confidence_category).toBe('high')
    expect(low.confidence_category).toBe('low')
  })

  it('reports confidence_category unknown when nothing justifies a guess', () => {
    const result = normalizeGPTZero({}, TEXT)
    expect(result.confidence_category).toBe('unknown')
  })

  it('locates sentence segments by their real char offsets in the original text', () => {
    const result = normalizeGPTZero({
      classification: 'mixed',
      sentences: [
        { sentence: 'The first sentence is here.', generated_prob: 0.9 },
        { sentence: 'The second sentence follows it.', generated_prob: 0.1 },
      ],
    }, TEXT)

    expect(result.segments).toHaveLength(2)
    expect(result.segments[0]).toMatchObject({ start_char: 0, end_char: 27, classification: 'ai-generated' })
    expect(result.segments[1]).toMatchObject({ start_char: 28, end_char: 59, classification: 'human-written' })
    for (const seg of result.segments) {
      expect(TEXT.slice(seg.start_char, seg.end_char)).toBe(seg.text)
    }
  })

  it('never manufactures estimated_ai_like_fraction when there are no sentence scores', () => {
    const result = normalizeGPTZero({ classification: 'ai', class_probabilities: { human: 0.1, ai: 0.9, mixed: 0 } }, TEXT)
    expect(result.estimated_ai_like_fraction).toBeNull()
  })

  it('derives estimated_ai_like_fraction from sentence-level scores when present', () => {
    const result = normalizeGPTZero({
      classification: 'mixed',
      sentences: [
        { sentence: 'The first sentence is here.', generated_prob: 0.8 },
        { sentence: 'The second sentence follows it.', generated_prob: 0.2 },
      ],
    }, TEXT)
    expect(result.estimated_ai_like_fraction).toBe(0.5)
  })

  it('rejects a non-object response as an invalid provider response', () => {
    expect(() => normalizeGPTZero(null, TEXT)).toThrow('GPTZero returned a non-object response.')
    expect(() => normalizeGPTZero('not json', TEXT)).toThrow('GPTZero returned a non-object response.')
  })
})

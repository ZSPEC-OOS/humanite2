import { describe, it, expect } from 'vitest'
import { toLegacyClassifyResult } from '../legacyAdapter'
import { DetectionResult } from '../contracts'

const TEXT = 'The first sentence is here. The second sentence follows it.'

function makeResult(overrides: Partial<DetectionResult> = {}): DetectionResult {
  return {
    schema_version: '3.0',
    provider: { id: 'gptzero' },
    classification: 'ai-generated',
    probabilities: { human: 0.08, ai: 0.87, mixed: 0.05 },
    predicted_class_probability: 0.87,
    confidence_category: 'high',
    estimated_ai_like_fraction: 0.85,
    segments: [
      { id: 'seg-0', text: 'The first sentence is here.', start_char: 0, end_char: 27, classification: 'ai-generated', ai_score: 0.9, highlighted_for_ai: true, source: 'gptzero' },
      { id: 'seg-1', text: 'The second sentence follows it.', start_char: 28, end_char: 59, classification: 'human-written', ai_score: 0.1, highlighted_for_ai: false, source: 'gptzero' },
    ],
    diagnostics: null,
    processing_duration_ms: 1234,
    warnings: [],
    explanation: { summary: 'Classified as ai-generated.' },
    ...overrides,
  }
}

describe('toLegacyClassifyResult', () => {
  it('maps classification and confidence straight through', () => {
    const legacy = toLegacyClassifyResult(makeResult(), TEXT)
    expect(legacy.classification).toBe('ai-generated')
    expect(legacy.confidence).toBe(0.87)
  })

  it('maps probabilities and derives uncertain_probability only for uncertain classifications', () => {
    const ai = toLegacyClassifyResult(makeResult(), TEXT)
    expect(ai.human_probability).toBe(0.08)
    expect(ai.ai_probability).toBe(0.87)
    expect(ai.uncertain_probability).toBe(0)

    const uncertain = toLegacyClassifyResult(makeResult({
      classification: 'uncertain',
      predicted_class_probability: 0.5,
    }), TEXT)
    expect(uncertain.uncertain_probability).toBe(0.5)
  })

  it('defaults null probabilities to 0 rather than propagating null into a non-nullable field', () => {
    const legacy = toLegacyClassifyResult(makeResult({
      probabilities: { human: null, ai: null, mixed: null },
    }), TEXT)
    expect(legacy.human_probability).toBe(0)
    expect(legacy.ai_probability).toBe(0)
  })

  it('falls back ai_fraction to ai_probability when estimated_ai_like_fraction is null', () => {
    const legacy = toLegacyClassifyResult(makeResult({ estimated_ai_like_fraction: null }), TEXT)
    expect(legacy.ai_fraction).toBe(0.87)
  })

  it('synthesizes full-document coverage from the actual word count', () => {
    const legacy = toLegacyClassifyResult(makeResult(), TEXT)
    const wordCount = TEXT.split(/\s+/).length
    expect(legacy.coverage).toEqual({ analyzed_tokens: wordCount, total_tokens: wordCount, fraction: 1 })
  })

  it('maps segments, defaulting a missing classification to uncertain', () => {
    const legacy = toLegacyClassifyResult(makeResult({
      segments: [{ id: 'seg-0', ai_score: 0.5, highlighted_for_ai: false, source: 'gptzero' }],
    }), TEXT)
    expect(legacy.segments).toHaveLength(1)
    expect(legacy.segments[0]).toMatchObject({
      id: 'seg-0',
      start_char: 0,
      end_char: 0,
      classification: 'uncertain',
      ai_probability: 0.5,
      confidence: 0,
    })
  })

  it('always returns an empty array for the fields GPTZero does not provide', () => {
    const legacy = toLegacyClassifyResult(makeResult(), TEXT)
    expect(legacy.per_sentence_perplexity).toEqual([])
    expect(legacy.top_features).toEqual([])
  })

  it('never leaves explanation.detail undefined', () => {
    const legacy = toLegacyClassifyResult(makeResult({ explanation: { summary: 'ok' } }), TEXT)
    expect(legacy.explanation).toEqual({ summary: 'ok', detail: '' })
  })

  it('carries the provider id through as model_used', () => {
    const legacy = toLegacyClassifyResult(makeResult({ provider: { id: 'mock' } }), TEXT)
    expect(legacy.model_used).toBe('mock')
  })
})

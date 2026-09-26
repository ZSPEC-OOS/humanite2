import { describe, it, expect } from 'vitest'
import { MockDetectionProvider } from '../providers/mock'

const SAMPLE_TEXT = 'The first sentence is here. The second sentence follows it. A third one closes it out.'

describe('MockDetectionProvider', () => {
  it('defaults to the human fixture', async () => {
    const provider = new MockDetectionProvider()
    const result = await provider.detect(SAMPLE_TEXT)
    expect(result.classification).toBe('human-written')
  })

  it('reports its provider id', () => {
    expect(new MockDetectionProvider().id).toBe('mock')
  })

  it.each([
    ['human', 'human-written'],
    ['ai', 'ai-generated'],
    ['mixed', 'mixed'],
    ['low-confidence', 'uncertain'],
  ] as const)('%s fixture classifies as %s', async (fixture, classification) => {
    const provider = new MockDetectionProvider(fixture)
    const result = await provider.detect(SAMPLE_TEXT)
    expect(result.classification).toBe(classification)
    expect(result.schema_version).toBe('3.0')
    expect(result.provider).toEqual({ id: 'mock' })
  })

  it.each(['human', 'ai', 'mixed', 'low-confidence'] as const)(
    'labels the %s fixture as a mock, never letting it read as a real detection',
    async fixture => {
      const provider = new MockDetectionProvider(fixture)
      const result = await provider.detect(SAMPLE_TEXT)
      expect(result.warnings[0]).toBe('Mock — not a real detection')
    },
  )

  it('never manufactures estimated_ai_like_fraction for a low-confidence result', async () => {
    const provider = new MockDetectionProvider('low-confidence')
    const result = await provider.detect(SAMPLE_TEXT)
    expect(result.estimated_ai_like_fraction).toBeNull()
    expect(result.confidence_category).toBe('low')
    expect(result.warnings.length).toBeGreaterThan(0)
  })

  it('produces segments whose char offsets resolve against the input text', async () => {
    const provider = new MockDetectionProvider('mixed')
    const result = await provider.detect(SAMPLE_TEXT)
    expect(result.segments.length).toBeGreaterThan(0)
    for (const seg of result.segments) {
      expect(seg.start_char).toBeGreaterThanOrEqual(0)
      expect(seg.end_char).toBeGreaterThan(seg.start_char!)
      expect(SAMPLE_TEXT.slice(seg.start_char, seg.end_char)).toBe(seg.text)
    }
    // A mixed fixture alternates classifications rather than reporting one.
    const distinctClassifications = new Set(result.segments.map(s => s.classification))
    expect(distinctClassifications.size).toBeGreaterThan(1)
  })

  it.each([
    ['timeout', 'PROVIDER_TIMEOUT'],
    ['rate-limit', 'PROVIDER_RATE_LIMITED'],
    ['invalid-response', 'INVALID_PROVIDER_RESPONSE'],
  ] as const)('%s fixture rejects with %s', async (fixture, code) => {
    const provider = new MockDetectionProvider(fixture)
    await expect(provider.detect(SAMPLE_TEXT)).rejects.toMatchObject({
      name: 'DetectionProviderError',
      code,
    })
  })
})

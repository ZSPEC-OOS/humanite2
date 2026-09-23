import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { GPTZeroProvider } from '../providers/gptzero'

// Integration coverage (spec §48-49): drives the real GPTZeroProvider —
// including its HTTP status mapping and normalizeGPTZero — against
// sanitized fixtures of GPTZero's documented response shape, rather than
// unit-testing normalizeGPTZero in isolation with hand-built objects (see
// normalize.test.ts) or GPTZeroProvider's error mapping with inline JSON
// (see gptzero.test.ts). CI runs entirely against these fixtures — never a
// live GPTZero request.

const FIXTURES_DIR = join(process.cwd(), 'tests', 'fixtures', 'gptzero')

function loadFixture(name: string): { status: number; body: unknown } {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, `${name}.json`), 'utf-8'))
}

function mockFetchWithFixture(name: string) {
  const { status, body } = loadFixture(name)
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  ))
}

const SAMPLE_TEXT =
  "I spent most of the afternoon trying to fix a leak under the kitchen sink. " +
  "Turns out it was just a loose washer, so at least it was an easy fix."

describe('GPTZeroProvider against production-shaped fixtures', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('human.json normalizes to a high-confidence human-written result', async () => {
    mockFetchWithFixture('human')
    const result = await new GPTZeroProvider('test-key').detect(SAMPLE_TEXT)
    expect(result.classification).toBe('human-written')
    expect(result.confidence_category).toBe('high')
    expect(result.probabilities.human).toBe(0.94)
    expect(result.segments).toHaveLength(2)
    expect(result.segments[0]!.start_char).toBe(0)
  })

  it('ai.json normalizes to a high-confidence ai-generated result', async () => {
    mockFetchWithFixture('ai')
    const result = await new GPTZeroProvider('test-key').detect(
      "In today's rapidly evolving digital landscape, it is imperative to leverage cutting-edge solutions. " +
      'This comprehensive approach facilitates seamless integration across multiple stakeholder touchpoints.',
    )
    expect(result.classification).toBe('ai-generated')
    expect(result.segments.every(s => s.highlighted_for_ai)).toBe(true)
  })

  it('mixed.json normalizes to mixed with per-sentence variation', async () => {
    mockFetchWithFixture('mixed')
    const result = await new GPTZeroProvider('test-key').detect(
      'I rewrote the intro a few times before it finally sounded right to me. ' +
      'Furthermore, this comprehensive framework facilitates optimal outcomes across diverse use cases. ' +
      'Anyway, I think the rest of the draft is in decent shape.',
    )
    expect(result.classification).toBe('mixed')
    const classifications = new Set(result.segments.map(s => s.classification))
    expect(classifications.has('ai-generated')).toBe(true)
    expect(classifications.has('human-written')).toBe(true)
  })

  it('low-confidence.json normalizes with confidence_category low and no manufactured estimate', async () => {
    mockFetchWithFixture('low-confidence')
    const result = await new GPTZeroProvider('test-key').detect('Short.')
    expect(result.confidence_category).toBe('low')
    // A single near-even sentence score doesn't collapse to null here since
    // one sentence score IS present — this checks the value is at least
    // plausible (0-1), not that it's suppressed.
    expect(result.estimated_ai_like_fraction).toBeGreaterThanOrEqual(0)
    expect(result.estimated_ai_like_fraction).toBeLessThanOrEqual(1)
  })

  it('malformed.json falls back to uncertain with a warning rather than throwing', async () => {
    mockFetchWithFixture('malformed')
    const result = await new GPTZeroProvider('test-key').detect(SAMPLE_TEXT)
    expect(result.classification).toBe('uncertain')
    expect(result.warnings.length).toBeGreaterThan(0)
    expect(result.segments).toEqual([])
  })

  it('rate-limit.json (HTTP 429) rejects with PROVIDER_RATE_LIMITED', async () => {
    mockFetchWithFixture('rate-limit')
    await expect(new GPTZeroProvider('test-key').detect(SAMPLE_TEXT)).rejects.toMatchObject({
      code: 'PROVIDER_RATE_LIMITED',
    })
  })
})

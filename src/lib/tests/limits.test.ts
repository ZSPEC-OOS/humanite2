import { describe, it, expect } from 'vitest'
import { SYNC_MAX_CHARS, ASYNC_MAX_CHARS, FREE_TIER_MAX_REQUEST_WORDS, FREE_TIER_MAX_REQUEST_CHARS, maxRequestCharsForTier } from '../limits'

describe('FREE_TIER_MAX_REQUEST_CHARS', () => {
  it('is derived from FREE_TIER_MAX_REQUEST_WORDS (300 words), not an independently-chosen number', () => {
    expect(FREE_TIER_MAX_REQUEST_WORDS).toBe(300)
    expect(FREE_TIER_MAX_REQUEST_CHARS).toBe(1_800)
  })

  it('is well below SYNC_MAX_CHARS — a Free request can never need background processing', () => {
    expect(FREE_TIER_MAX_REQUEST_CHARS).toBeLessThan(SYNC_MAX_CHARS)
  })
})

describe('maxRequestCharsForTier', () => {
  it('returns the Free-specific ceiling only for free', () => {
    expect(maxRequestCharsForTier('free')).toBe(FREE_TIER_MAX_REQUEST_CHARS)
  })

  it('returns the shared ASYNC_MAX_CHARS ceiling for every other known tier', () => {
    expect(maxRequestCharsForTier('starter')).toBe(ASYNC_MAX_CHARS)
    expect(maxRequestCharsForTier('pro')).toBe(ASYNC_MAX_CHARS)
    expect(maxRequestCharsForTier('enterprise')).toBe(ASYNC_MAX_CHARS)
    expect(maxRequestCharsForTier('gold')).toBe(ASYNC_MAX_CHARS)
  })

  it('treats an unrecognized tier the same as a paid tier, not as Free', () => {
    // A missing/garbled tier claim must never silently grant the MORE
    // restrictive Free cap to a paid account, nor the full ceiling to an
    // actually-expired/unrecognized Free claim — usageLimits.ts's own
    // normalizeTier() is what maps an unknown tier to 'free' for QUOTA
    // purposes; this function is intentionally simpler (exact match only)
    // since a wrong per-request cap is a much smaller blast radius than a
    // wrong quota, and defaulting here to the generous ceiling avoids
    // ever rejecting a legitimate paid request due to a claims hiccup.
    expect(maxRequestCharsForTier('not-a-real-tier')).toBe(ASYNC_MAX_CHARS)
  })
})

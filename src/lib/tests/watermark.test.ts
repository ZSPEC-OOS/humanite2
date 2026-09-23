import { describe, it, expect } from 'vitest'
import { generateWatermark, hashContent } from '../watermark'

describe('hashContent', () => {
  it('is deterministic for identical text', () => {
    expect(hashContent('the quick brown fox')).toBe(hashContent('the quick brown fox'))
  })

  it('differs for different text', () => {
    expect(hashContent('the quick brown fox')).not.toBe(hashContent('the slow brown fox'))
  })

  it('is sensitive to even a single-character difference', () => {
    expect(hashContent('output text.')).not.toBe(hashContent('output text!'))
  })
})

describe('generateWatermark', () => {
  it('produces a fingerprint and a verification URL referencing it', () => {
    const watermark = generateWatermark('job-123', 'gpt-4o-mini')
    expect(watermark.job_id).toBe('job-123')
    expect(watermark.model).toBe('gpt-4o-mini')
    expect(watermark.fingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(watermark.verification_url).toContain(watermark.fingerprint)
  })

  it('produces different fingerprints for different jobs', () => {
    const a = generateWatermark('job-a', 'gpt-4o-mini')
    const b = generateWatermark('job-b', 'gpt-4o-mini')
    expect(a.fingerprint).not.toBe(b.fingerprint)
  })
})

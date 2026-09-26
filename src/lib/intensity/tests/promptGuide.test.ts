import { describe, it, expect } from 'vitest'
import { buildIntensityGuide } from '../promptGuide'

describe('buildIntensityGuide', () => {
  it('names the exact level and never fabricates a syntactic claim', () => {
    const guide = buildIntensityGuide(7)
    expect(guide).toContain('Intensity 7/10')
    expect(guide).not.toMatch(/syntactic/i)
  })

  it('produces a distinct guide for every one of the 10 levels', () => {
    const guides = new Set(Array.from({ length: 10 }, (_, i) => buildIntensityGuide(i + 1)))
    expect(guides.size).toBe(10)
  })

  it('never recommends em-dashes or rhetorical questions, even at the highest intensity (a recognized AI tell)', () => {
    const guide = buildIntensityGuide(10)
    expect(guide).not.toMatch(/em-dash/i)
    expect(guide).not.toMatch(/rhetorical question/i)
  })

  it('tells the model to keep paragraph breaks fixed at low intensity, where the target is 0', () => {
    expect(buildIntensityGuide(1)).toMatch(/keep every paragraph break exactly/i)
  })

  it('allows paragraph restructuring at high intensity, where the target is above 0', () => {
    expect(buildIntensityGuide(10)).toMatch(/paragraph boundaries may change/i)
  })

  it('tells the model to preserve sentence order at low intensity, where the discourse target is 0', () => {
    expect(buildIntensityGuide(1)).toMatch(/keep sentences in their original order/i)
  })

  it('allows sentence reordering at high intensity, where the discourse target is highest', () => {
    expect(buildIntensityGuide(10)).toMatch(/may be reorganized/i)
  })
})

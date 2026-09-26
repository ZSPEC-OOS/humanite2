import { describe, it, expect } from 'vitest'
import { compileStyle } from '../compiler'
import { buildStyleSection } from '../promptBuilder'
import { TONE_PROFILES } from '../toneProfiles'
import { DOMAIN_PROFILES } from '../domainProfiles'
import { TONES, DOMAINS } from '../types'

describe('compileStyle — every tone/domain pair', () => {
  it('produces at least one rule for every (tone, domain) combination', () => {
    for (const tone of TONES) {
      for (const domain of DOMAINS) {
        const compiled = compileStyle(tone, domain)
        expect(compiled.rules.length, `${tone} x ${domain}`).toBeGreaterThan(0)
      }
    }
  })
})

describe('compileStyle — domain overrides tone', () => {
  it('legal always forbids contractions, even when the casual tone would otherwise encourage them', () => {
    const casualAlone = compileStyle('casual', 'general')
    expect(casualAlone.rules.some(r => r.tag === 'contractions' && /freely/i.test(r.text))).toBe(true)

    const casualLegal = compileStyle('casual', 'legal')
    // The casual tone's contraction-encouraging rule must be gone...
    expect(casualLegal.rules.some(r => r.tag === 'contractions' && /freely/i.test(r.text))).toBe(false)
    // ...replaced by legal's own, which forbids them outright.
    expect(casualLegal.rules.some(r => r.tag === 'contractions' && /never use contractions/i.test(r.text))).toBe(true)
  })

  it('medical always preserves clinical hedging strength, even under the casual tone', () => {
    const compiled = compileStyle('casual', 'medical')
    expect(compiled.rules.some(r => r.tag === 'hedging' && /may cause.*must not become.*causes/i.test(r.text))).toBe(true)
    // The generic "keep hedging light" casual rule must not also be present
    // for the same tag — the domain rule replaces it, not adds to it.
    expect(compiled.rules.filter(r => r.tag === 'hedging')).toHaveLength(1)
  })

  it('academic domain overrides hedging strength regardless of the selected tone, independent of the "academic" tone value', () => {
    // tone=professional + domain=academic exercises the tone/domain name
    // collision directly: two independent axes that happen to share a label.
    const compiled = compileStyle('professional', 'academic')
    expect(compiled.rules.some(r => r.tag === 'hedging' && /suggests.*must not become.*proves/i.test(r.text))).toBe(true)
    expect(compiled.rules.filter(r => r.tag === 'hedging')).toHaveLength(1)
  })

  it('technical domain overrides vocabulary substitution so identifiers are never rephrased', () => {
    const compiled = compileStyle('casual', 'technical')
    expect(compiled.rules.some(r => r.tag === 'vocabulary' && /character-for-character/i.test(r.text))).toBe(true)
    expect(compiled.rules.filter(r => r.tag === 'vocabulary')).toHaveLength(1)
  })

  it('general domain applies no overrides — the tone\'s own rules pass through unchanged', () => {
    for (const tone of TONES) {
      const compiled = compileStyle(tone, 'general')
      const toneProfile = TONE_PROFILES[tone]
      expect(compiled.rules).toHaveLength(toneProfile.rules.length)
    }
  })
})

describe('domain profiles — internal consistency', () => {
  it('every tag a domain overrides is actually covered by one of that domain\'s own rules', () => {
    for (const domain of DOMAINS) {
      const profile = DOMAIN_PROFILES[domain]
      const coveredTags = new Set(profile.rules.map(r => r.tag))
      for (const overriddenTag of profile.overrides) {
        expect(coveredTags.has(overriddenTag), `${domain} overrides '${overriddenTag}' but supplies no replacement rule`).toBe(true)
      }
    }
  })
})

describe('buildStyleSection', () => {
  it('renders the tone, domain, and every compiled rule\'s text', () => {
    const compiled = compileStyle('casual', 'legal')
    const section = buildStyleSection(compiled)
    expect(section).toContain('Tone: casual')
    expect(section).toContain('Domain: legal')
    for (const rule of compiled.rules) {
      expect(section).toContain(rule.text)
    }
  })

  it('omits the examples block entirely when there are no examples', () => {
    const compiled = compileStyle('balanced', 'general')
    expect(compiled.examples).toHaveLength(0)
    expect(buildStyleSection(compiled)).not.toMatch(/Example of this register/)
  })
})

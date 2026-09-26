import { describe, it, expect } from 'vitest'
import { compileStyle } from '../compiler'
import { buildStyleSection } from '../promptBuilder'
import { TONE_PROFILES } from '../toneProfiles'
import { DOMAIN_PROFILES } from '../domainProfiles'
import { GENRE_PROFILES } from '../genreProfiles'
import { AUDIENCE_PROFILES } from '../audienceProfiles'
import { TONES, DOMAINS, GENRES, AUDIENCES } from '../types'

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

  it('omits the genre/audience lines entirely when neither is selected', () => {
    const compiled = compileStyle('balanced', 'general')
    const section = buildStyleSection(compiled)
    expect(section).not.toMatch(/Genre:/)
    expect(section).not.toMatch(/Audience:/)
  })
})

// ── Phase 10: genre and audience overlays ────────────────────────────────────

describe('compileStyle — genre and audience are optional overlays', () => {
  it('produces the byte-identical rule set when genre/audience are omitted, matching pre-Phase-10 behavior', () => {
    for (const tone of TONES) {
      for (const domain of DOMAINS) {
        expect(compileStyle(tone, domain, null, null)).toEqual(compileStyle(tone, domain))
      }
    }
  })

  it('changes the compiled rule set for every (genre, audience) combination relative to a bare tone/domain pair', () => {
    // A genre/audience combo can leave the rule COUNT unchanged (it may
    // override exactly the tags it replaces, 1-for-1) — the real invariant
    // is that the rule TEXT differs, not that more rules pile up.
    const bare = compileStyle('balanced', 'general').rules.map(r => r.text).sort()
    for (const genre of GENRES) {
      for (const audience of AUDIENCES) {
        const overlaid = compileStyle('balanced', 'general', genre, audience).rules.map(r => r.text).sort()
        expect(overlaid, `${genre} x ${audience}`).not.toEqual(bare)
      }
    }
  })

  it('reports the selected genre/audience on the compiled result', () => {
    const compiled = compileStyle('balanced', 'general', 'email', 'executive')
    expect(compiled.genre).toBe('email')
    expect(compiled.audience).toBe('executive')
  })

  it('reports null for an unselected genre/audience, never a fabricated default', () => {
    const compiled = compileStyle('balanced', 'general')
    expect(compiled.genre).toBeNull()
    expect(compiled.audience).toBeNull()
  })
})

describe('compileStyle — precedence chain: domain > genre > audience > tone', () => {
  it('genre overrides tone on a shared tag', () => {
    // research_paper overrides "person" to third-person; casual tone
    // otherwise permits first/second person freely.
    const compiled = compileStyle('casual', 'general', 'research_paper')
    expect(compiled.rules.some(r => r.tag === 'person' && /third-person/i.test(r.text))).toBe(true)
    expect(compiled.rules.filter(r => r.tag === 'person')).toHaveLength(1)
  })

  it('audience overrides tone on a shared tag', () => {
    // patient audience overrides "vocabulary" to plain language; casual
    // tone's own vocabulary rule must not also survive for the same tag.
    const compiled = compileStyle('casual', 'general', null, 'patient')
    expect(compiled.rules.some(r => r.tag === 'vocabulary' && /plain-language equivalents/i.test(r.text))).toBe(true)
    expect(compiled.rules.filter(r => r.tag === 'vocabulary')).toHaveLength(1)
  })

  it('genre overrides audience on a shared tag', () => {
    // documentation overrides "vocabulary" (UI labels verbatim); expert
    // audience also has a vocabulary rule — genre must win.
    const compiled = compileStyle('balanced', 'general', 'documentation', 'expert')
    expect(compiled.rules.some(r => r.tag === 'vocabulary' && /character-for-character/i.test(r.text))).toBe(true)
    expect(compiled.rules.filter(r => r.tag === 'vocabulary')).toHaveLength(1)
  })

  it('domain overrides genre and audience on a shared tag — the top of the precedence chain', () => {
    // legal domain always forbids contractions; contract genre agrees, but
    // even if it didn't, domain must win over both genre and audience.
    const compiled = compileStyle('casual', 'legal', 'contract', 'customer')
    expect(compiled.rules.some(r => r.tag === 'contractions' && /never use contractions/i.test(r.text))).toBe(true)
    expect(compiled.rules.filter(r => r.tag === 'contractions')).toHaveLength(1)
  })

  it('domain overrides a genre that disagrees with it on the same tag', () => {
    // legal forbids contractions; blog genre's own contraction rule
    // encourages them — domain must still win.
    const compiled = compileStyle('casual', 'legal', 'blog')
    expect(compiled.rules.some(r => r.tag === 'contractions' && /never use contractions/i.test(r.text))).toBe(true)
    expect(compiled.rules.some(r => r.tag === 'contractions' && /conversational register/i.test(r.text))).toBe(false)
  })
})

describe('genre/audience profiles — internal consistency', () => {
  it('every tag a genre overrides is actually covered by one of that genre\'s own rules', () => {
    for (const genre of GENRES) {
      const profile = GENRE_PROFILES[genre]
      const coveredTags = new Set(profile.rules.map(r => r.tag))
      for (const overriddenTag of profile.overrides) {
        expect(coveredTags.has(overriddenTag), `${genre} overrides '${overriddenTag}' but supplies no replacement rule`).toBe(true)
      }
    }
  })

  it('every tag an audience overrides is actually covered by one of that audience\'s own rules', () => {
    for (const audience of AUDIENCES) {
      const profile = AUDIENCE_PROFILES[audience]
      const coveredTags = new Set(profile.rules.map(r => r.tag))
      for (const overriddenTag of profile.overrides) {
        expect(coveredTags.has(overriddenTag), `${audience} overrides '${overriddenTag}' but supplies no replacement rule`).toBe(true)
      }
    }
  })
})

describe('buildStyleSection — genre/audience lines', () => {
  it('renders both lines when both are selected', () => {
    const compiled = compileStyle('balanced', 'general', 'email', 'executive')
    const section = buildStyleSection(compiled)
    expect(section).toContain('Genre: email')
    expect(section).toContain('Audience: executive')
  })

  it('renders only the one that is selected', () => {
    const compiled = compileStyle('balanced', 'general', 'email')
    const section = buildStyleSection(compiled)
    expect(section).toContain('Genre: email')
    expect(section).not.toMatch(/Audience:/)
  })
})

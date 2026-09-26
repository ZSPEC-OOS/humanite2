import { TONE_PROFILES } from './toneProfiles'
import { DOMAIN_PROFILES } from './domainProfiles'
import { GENRE_PROFILES } from './genreProfiles'
import { AUDIENCE_PROFILES } from './audienceProfiles'
import type { Audience, CompiledStyle, Domain, Genre, StyleRule, Tone } from './types'

// Turns a (tone, domain, genre?, audience?) combination into explicit,
// composable rules — replacing the previous "Tone: X\nDomain: Y" flat
// label pass-through in humanizePipeline.ts's buildUserPrompt with real,
// checkable behaviour.
//
// Layered from lowest to highest precedence — "domain > genre > audience >
// tone" per the plan's Phase 10 spec (Phase 3 established domain > tone;
// Phase 10 slots genre and audience into the chain between them). Each
// layer's own `overrides` list prunes any rule already accumulated from a
// LOWER-precedence layer that shares its tag, then appends its own rules —
// so a higher layer always wins a same-tag conflict, and layers that never
// conflict simply add up. Genre/audience are optional: omitted, this
// behaves byte-for-byte like Phase 3's tone/domain-only compiler.
export function compileStyle(tone: Tone, domain: Domain, genre?: Genre | null, audience?: Audience | null): CompiledStyle {
  const toneProfile = TONE_PROFILES[tone]
  const domainProfile = DOMAIN_PROFILES[domain]
  const genreProfile = genre ? GENRE_PROFILES[genre] : null
  const audienceProfile = audience ? AUDIENCE_PROFILES[audience] : null

  let rules: StyleRule[] = [...toneProfile.rules]
  let examples = [...toneProfile.examples]

  if (audienceProfile) {
    rules = rules.filter(rule => !audienceProfile.overrides.includes(rule.tag))
    rules = [...rules, ...audienceProfile.rules]
    examples = [...examples, ...audienceProfile.examples]
  }
  if (genreProfile) {
    rules = rules.filter(rule => !genreProfile.overrides.includes(rule.tag))
    rules = [...rules, ...genreProfile.rules]
    examples = [...examples, ...genreProfile.examples]
  }
  rules = rules.filter(rule => !domainProfile.overrides.includes(rule.tag))
  rules = [...rules, ...domainProfile.rules]
  examples = [...examples, ...domainProfile.examples]

  return {
    tone,
    domain,
    genre: genre ?? null,
    audience: audience ?? null,
    rules,
    examples,
  }
}

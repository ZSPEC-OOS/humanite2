import { TONE_PROFILES } from './toneProfiles'
import { DOMAIN_PROFILES } from './domainProfiles'
import type { CompiledStyle, Domain, StyleRule, Tone } from './types'

// Turns a (tone, domain) pair into explicit, composable rules — replacing
// the previous "Tone: X\nDomain: Y" flat label pass-through in
// humanizePipeline.ts's buildUserPrompt with real, checkable behaviour.
//
// Domain rules override tone rules on any tag they both govern: a tone
// rule is dropped if the domain's `overrides` list names its tag, and the
// domain's own rule for that tag is appended instead. E.g. tone=casual
// normally encourages contractions, but domain=legal always forbids them
// — the legal rule wins. "Domain rules are constraints that override
// tone" per the plan's Phase 3 spec.
export function compileStyle(tone: Tone, domain: Domain): CompiledStyle {
  const toneProfile = TONE_PROFILES[tone]
  const domainProfile = DOMAIN_PROFILES[domain]

  const toneRules = toneProfile.rules.filter(rule => !domainProfile.overrides.includes(rule.tag))
  const rules: StyleRule[] = [...toneRules, ...domainProfile.rules]

  return {
    tone,
    domain,
    rules,
    examples: [...toneProfile.examples, ...domainProfile.examples],
  }
}

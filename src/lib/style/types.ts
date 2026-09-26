// The style compiler's own types. Tone and Domain match the product's real
// UI surface exactly (src/components/editor/ControlPanel.tsx's TONES/
// DOMAINS arrays) — the plan describes "3 discrete bands (low/mid/high)
// per StyleSpec dimension", but this product exposes tone and domain as
// two independent, already-discrete named selectors rather than a
// continuous multi-axis StyleSpec. Treating each named tone/domain value
// as its own profile is the same underlying idea (discrete, verifiable
// categories rather than an unverifiable continuous knob — see the plan's
// own "avoids unverifiable precision" reasoning for discrete bands) applied
// to the surface that actually exists today.

export type Tone = 'balanced' | 'formal' | 'casual' | 'academic' | 'professional'
export type Domain = 'general' | 'academic' | 'business' | 'technical' | 'medical' | 'legal'

export const TONES: readonly Tone[] = ['balanced', 'formal', 'casual', 'academic', 'professional']
export const DOMAINS: readonly Domain[] = ['general', 'academic', 'business', 'technical', 'medical', 'legal']

function isTone(value: string): value is Tone {
  return (TONES as readonly string[]).includes(value)
}

function isDomain(value: string): value is Domain {
  return (DOMAINS as readonly string[]).includes(value)
}

// buildUserPrompt's tone/domain parameters are plain strings (matching
// HumanizeSettings and the request body they ultimately come from, neither
// of which validates against TONES/DOMAINS today) — these coerce an
// unrecognized value to a safe default instead of the compiler crashing on
// an invalid Record key. Locking down request-level validation is a
// separate concern from this phase.
export function toValidTone(value: string): Tone {
  return isTone(value) ? value : 'balanced'
}

export function toValidDomain(value: string): Domain {
  return isDomain(value) ? value : 'general'
}

// Phase 10: genre and audience compile as OVERLAYS on top of tone/domain,
// per the plan's own precedence: "domain > genre > audience > tone". Unlike
// tone/domain (always one of a fixed set, defaulting to balanced/general),
// genre and audience are OPTIONAL — a caller who never selects one gets no
// overlay at all, not a fabricated default, since there's no neutral
// "general genre" the way there's a neutral "general domain".
export type Genre =
  | 'essay' | 'research_paper' | 'report' | 'email' | 'proposal' | 'blog'
  | 'documentation' | 'clinical_note' | 'patient_instructions' | 'contract' | 'memo'

export type Audience =
  | 'general' | 'expert' | 'executive' | 'academic' | 'customer' | 'patient' | 'regulatory'

export const GENRES: readonly Genre[] = [
  'essay', 'research_paper', 'report', 'email', 'proposal', 'blog',
  'documentation', 'clinical_note', 'patient_instructions', 'contract', 'memo',
]

export const AUDIENCES: readonly Audience[] = [
  'general', 'expert', 'executive', 'academic', 'customer', 'patient', 'regulatory',
]

function isGenre(value: string): value is Genre {
  return (GENRES as readonly string[]).includes(value)
}

function isAudience(value: string): value is Audience {
  return (AUDIENCES as readonly string[]).includes(value)
}

// Returns null (no overlay) for an absent or unrecognized value — never a
// fabricated fallback genre/audience the caller never asked for.
export function toValidGenre(value: string | undefined | null): Genre | null {
  return value != null && isGenre(value) ? value : null
}

export function toValidAudience(value: string | undefined | null): Audience | null {
  return value != null && isAudience(value) ? value : null
}

// A tag names which stylistic axis a rule governs, so a domain constraint
// can override a tone rule on the same axis by tag rather than by
// string-matching rule text.
export type StyleRuleTag = 'contractions' | 'sentence-length' | 'person' | 'hedging' | 'vocabulary' | 'structure'

export interface StyleRule {
  tag: StyleRuleTag
  text: string
}

// A short excerpt illustrating a profile's register. Populated directly on
// each profile as static data (never fetched at runtime from
// tests/benchmark/reference/ — production code must not depend on test
// fixtures) — see toneProfiles.ts and domainProfiles.ts for why these are
// currently empty.
export interface StyleExample {
  text: string
  source: string
}

export interface ToneProfile {
  tone: Tone
  description: string
  rules: StyleRule[]
  examples: StyleExample[]
}

export interface DomainProfile {
  domain: Domain
  description: string
  // Constraints this domain always applies, regardless of tone.
  rules: StyleRule[]
  examples: StyleExample[]
  // Tags this domain's rules take precedence over — any tone rule sharing
  // one of these tags is dropped in favor of this domain's own rule for
  // that tag. "Domain rules are constraints that override tone" per the
  // plan's Phase 3 spec.
  overrides: StyleRuleTag[]
}

export interface GenreProfile {
  genre: Genre
  description: string
  rules: StyleRule[]
  examples: StyleExample[]
  // Tags this genre's rules take precedence over — for anything BELOW it
  // in the domain > genre > audience > tone chain (audience and tone).
  overrides: StyleRuleTag[]
}

export interface AudienceProfile {
  audience: Audience
  description: string
  rules: StyleRule[]
  examples: StyleExample[]
  // Tags this audience's rules take precedence over — tone only; domain
  // and genre both outrank audience in the precedence chain.
  overrides: StyleRuleTag[]
}

export interface CompiledStyle {
  tone: Tone
  domain: Domain
  genre: Genre | null
  audience: Audience | null
  rules: StyleRule[]
  examples: StyleExample[]
}

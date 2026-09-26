import type { Domain } from '@/lib/style/types'

export type { Domain }

// Per-level transformation targets. `syntactic` stays null at every level
// — deferred until a TypeScript-compatible parser is selected (an open
// question the plan itself names for Phase 4), never fabricated as a
// number nothing in this codebase actually measures yet. The other four
// dimensions are expressed as target ratios the evaluator
// (src/lib/evaluation/intensity.ts) checks real output against.
export interface IntensityTarget {
  level: number
  lexical: number
  syntactic: null
  sentence: number
  paragraph: number
  discourse: number
}

// "Effective intensity = min(requested, domain cap)" — corrects the
// draft's "intensity 10 = full reconstruction everywhere", which conflicts
// with the domain preservation rules src/lib/style/domainProfiles.ts
// already encodes (legal/medical/technical all forbid rephrasing certain
// content regardless of tone or intensity). "others" from the plan's cap
// table covers business and general, the two domains style/domainProfiles.ts
// gives no special constraints.
export const DOMAIN_INTENSITY_CAPS: Record<Domain, number> = {
  legal: 4,
  medical: 5,
  technical: 7,
  academic: 8,
  business: 10,
  general: 10,
}

export interface EffectiveIntensity {
  requested: number
  applied: number
  domain: Domain
  capped: boolean
}

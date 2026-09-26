import { DOMAIN_INTENSITY_CAPS } from './types'
import type { Domain, EffectiveIntensity } from './types'

// "Effective intensity = min(requested, domain cap)." The caller is
// responsible for using `.applied`, not `.requested`, for the actual
// generation call — see buildUserPrompt/humanizeChunk's call site in
// src/app/api/v1/humanize/route.ts.
export function effectiveIntensity(requested: number, domain: Domain): EffectiveIntensity {
  const cap = DOMAIN_INTENSITY_CAPS[domain]
  const applied = Math.min(requested, cap)
  return { requested, applied, domain, capped: applied < requested }
}

import type { DocumentContext } from './types'

// "A final consistency check finds terminology, abbreviation ... drift."
// Terminology and abbreviations get two DIFFERENT measurements here, not
// one blended number: a terminology entry names exactly one banned variant
// per canonical form, so "did a banned variant sneak in" is a precise,
// checkable claim. An abbreviation entry names only its OWN canonical
// expansion — this checker has no way to enumerate what a WRONG expansion
// would even look like, so the honest, checkable claim for abbreviations is
// narrower: survival (the abbreviation or its canonical expansion appears
// somewhere at all), the same kind of preservation check Phase 5's fact
// ledger already applies to other locked spans.

export interface TerminologyViolation {
  variant: string
  canonical: string
  // How many times the banned variant appears in the checked text.
  count: number
}

export interface AbbreviationGap {
  abbreviation: string
  expansion: string
}

export interface ConsistencyResult {
  // Fraction of canonical-term "opportunities" (occurrences of either the
  // canonical form or a banned variant) that used the canonical form — 1
  // when there was nothing to check (no variants were ever identified, or
  // none of them come up in the checked text either way). This is exactly
  // "terminology consistency" per the plan's own acceptance criterion.
  terminologyConsistency: number
  terminologyViolations: TerminologyViolation[]
  // Fraction of abbreviations whose concept (its own form or its canonical
  // expansion) survives somewhere in the checked text at all.
  abbreviationPreservation: number
  abbreviationGaps: AbbreviationGap[]
}

// Lookaround boundaries rather than \b: a short term ("Co", "API") must
// never match as a substring inside an unrelated longer word ("Company",
// "APIs") — the same convention preprocess.ts's NUMBER_RE and
// fidelity/extractors/quantities.ts already use for the same reason.
function countOccurrencesCaseInsensitive(haystack: string, needle: string): number {
  const trimmed = needle.trim()
  if (!trimmed) return 0
  const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(`(?<![a-zA-Z0-9])${escaped}(?![a-zA-Z0-9])`, 'gi')
  return (haystack.match(re) ?? []).length
}

function round(n: number): number {
  return Math.round(n * 10000) / 10000
}

export function checkTerminologyConsistency(context: DocumentContext, outputText: string): ConsistencyResult {
  const terminologyViolations: TerminologyViolation[] = []
  let totalOpportunities = 0
  let canonicalUses = 0

  for (const [variant, canonical] of Object.entries(context.terminology)) {
    if (variant.trim().toLowerCase() === canonical.trim().toLowerCase()) continue
    const variantCount = countOccurrencesCaseInsensitive(outputText, variant)
    const canonicalCount = countOccurrencesCaseInsensitive(outputText, canonical)
    const total = variantCount + canonicalCount
    // Neither form appears — this term's concept simply wasn't part of
    // whatever the checked text covers; not measured, not penalized.
    if (total === 0) continue

    totalOpportunities += total
    canonicalUses += canonicalCount
    if (variantCount > 0) terminologyViolations.push({ variant, canonical, count: variantCount })
  }

  const terminologyConsistency = totalOpportunities === 0 ? 1 : round(canonicalUses / totalOpportunities)

  const abbreviationGaps: AbbreviationGap[] = []
  let abbreviationsChecked = 0
  let abbreviationsPreserved = 0
  for (const [abbreviation, expansion] of Object.entries(context.abbreviations)) {
    abbreviationsChecked++
    const survives = countOccurrencesCaseInsensitive(outputText, abbreviation) > 0
      || countOccurrencesCaseInsensitive(outputText, expansion) > 0
    if (survives) abbreviationsPreserved++
    else abbreviationGaps.push({ abbreviation, expansion })
  }
  const abbreviationPreservation = abbreviationsChecked === 0 ? 1 : round(abbreviationsPreserved / abbreviationsChecked)

  return { terminologyConsistency, terminologyViolations, abbreviationPreservation, abbreviationGaps }
}

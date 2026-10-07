// PORTED from humanite2 src/lib/a2h/a2h16.ts @ 141e366: the pure scoring core only (Firestore reporting rows/reports removed).
// NOT PORTED: the verifier-calibration subtest (CLAIM_VERIFIER_CALIBRATION_SET, runClaimVerifierCalibration,
// computeCalibrationResult) and the `verifyClaims` import from '@/lib/claims': they measure the model-based
// claim verifier, which stays in Humanite. The ark scores only the deterministic literal classification below.
import type { BenchmarkFixture, DeterministicEvaluation } from '../shared/types'

export const A2H16_CODE = 'A2H-16' as const

// A2H-16 — Claim-Relationship Preservation (§23-29). Unlike A2H-06/A2H-12's
// controlled-derivative fixtures, a claim_relationship fixture annotates a
// REAL claim within a frozen source's own text (sourceStart/sourceEnd/
// sourceText, same provenance fields A2H-04's citation fixtures use) — there
// is no auto-scanner for it (like terminology, encoding a claim's structured
// ground truth is a curation judgment call this module has no basis for
// guessing), so it is admin-curated only, evaluated against the ordinary
// BenchmarkOutput for that (source, intensity) via the same output-scoped
// DETERMINISTIC_EVALUATORS pattern as A2H-04/05/09/10/13.
export type ClaimRelationshipCategory = 'causal' | 'comparative' | 'attribution' | 'qualifier' | 'condition' | 'exception'

export const CLAIM_RELATIONSHIP_CATEGORIES: readonly ClaimRelationshipCategory[] = [
  'causal', 'comparative', 'attribution', 'qualifier', 'condition', 'exception',
]

export interface ClaimRelationshipFixtureExpected {
  category: ClaimRelationshipCategory
  sourceText: string
  subject?: string | null
  relation: string
  object?: string | null
  qualifier?: string | null
  attribution?: string | null
  // Paraphrasings of sourceText an admin has pre-approved as still preserving
  // the same relationship — the deterministic classifier's only way to
  // recognize a CORRECT rewording as "preserved" without an LLM judge (§26:
  // "primary scoring must never rely on an LLM judge").
  approvedEquivalentForms?: string[]
  // Known-bad phrasings that would indicate this relationship was corrupted
  // (a reversed direction, a reassigned attribution, a dropped qualifier) —
  // matched literally against the output; presence of one of these always
  // wins over an approved form also matching elsewhere in the text.
  knownCorruptions?: Array<{ type: string; text: string }>
}

export function validateClaimRelationshipFixtureExpected(expected: Record<string, unknown>): string[] {
  const errors: string[] = []
  const category = expected['category']
  const sourceText = expected['sourceText']
  const relation = expected['relation']
  if (typeof category !== 'string' || !CLAIM_RELATIONSHIP_CATEGORIES.includes(category as ClaimRelationshipCategory)) {
    errors.push(`category must be one of ${CLAIM_RELATIONSHIP_CATEGORIES.join(', ')}.`)
  }
  if (typeof sourceText !== 'string' || !sourceText.trim()) errors.push('sourceText is required.')
  if (typeof relation !== 'string' || !relation.trim()) errors.push('relation is required.')
  const approved = expected['approvedEquivalentForms']
  if (approved !== undefined && (!Array.isArray(approved) || approved.some(f => typeof f !== 'string'))) {
    errors.push('approvedEquivalentForms must be an array of strings if present.')
  }
  const corruptions = expected['knownCorruptions']
  if (corruptions !== undefined) {
    if (!Array.isArray(corruptions) || corruptions.some(c => typeof c !== 'object' || c == null || typeof (c as Record<string, unknown>)['type'] !== 'string' || typeof (c as Record<string, unknown>)['text'] !== 'string')) {
      errors.push('knownCorruptions must be an array of {type, text} objects if present.')
    }
  }
  return errors
}

// Boundary-safe substring check (adjacent-character check rather than regex
// `\b`, which fails immediately after punctuation — the same class of bug
// documented in a2h06.ts/a2h12.ts).
function containsExact(haystack: string, needle: string): boolean {
  const trimmed = needle.trim()
  if (!trimmed) return false
  return haystack.includes(trimmed)
}

export type ClaimPreservationStatus = 'preserved' | 'corrupted' | 'uncertain'

// Pure, deterministic classifier — no LLM. A known corruption's literal
// phrasing appearing anywhere in the output is a real defect even if some
// approved form also happens to match elsewhere in a long document, so a
// corruption match always wins over an approved-form match. Neither
// matching is 'uncertain', not a fabricated verdict: the model rewrote the
// claim beyond what this fixture's known forms can recognize.
export function classifyClaimRelationshipPreservation(expected: ClaimRelationshipFixtureExpected, outputText: string): ClaimPreservationStatus {
  const approvedForms = [expected.sourceText, ...(expected.approvedEquivalentForms ?? [])]
  const hasApproved = approvedForms.some(form => containsExact(outputText, form))
  const corruptions = expected.knownCorruptions ?? []
  const hasCorruption = corruptions.some(c => containsExact(outputText, c.text))
  if (hasCorruption) return 'corrupted'
  if (hasApproved) return 'preserved'
  return 'uncertain'
}

export interface ClaimRelationshipFixtureResult {
  fixtureId: string
  category: ClaimRelationshipCategory
  status: ClaimPreservationStatus
}

export interface A2H16Measurements {
  eligible: boolean
  fixtureCount: number
  preservedCount: number
  corruptedCount: number
  uncertainCount: number
  preservationRate: number | null
  results: ClaimRelationshipFixtureResult[]
}

export function computeA2H16Measurements(fixtures: BenchmarkFixture[], outputText: string): A2H16Measurements {
  const claimFixtures = fixtures.filter(f => f.type === 'claim_relationship')
  if (claimFixtures.length === 0) {
    return { eligible: false, fixtureCount: 0, preservedCount: 0, corruptedCount: 0, uncertainCount: 0, preservationRate: null, results: [] }
  }
  const results: ClaimRelationshipFixtureResult[] = claimFixtures.map(f => {
    const expected = f.expected as unknown as ClaimRelationshipFixtureExpected
    return { fixtureId: f.id, category: expected.category, status: classifyClaimRelationshipPreservation(expected, outputText) }
  })
  const preservedCount = results.filter(r => r.status === 'preserved').length
  const corruptedCount = results.filter(r => r.status === 'corrupted').length
  const uncertainCount = results.filter(r => r.status === 'uncertain').length
  return {
    eligible: true,
    fixtureCount: results.length,
    preservedCount,
    corruptedCount,
    uncertainCount,
    preservationRate: preservedCount / results.length,
    results,
  }
}

// The pass rule (null when the source has no fixtures of this type).
export function a2h16Passed(m: A2H16Measurements): boolean | null {
  return m.eligible ? m.corruptedCount === 0 : null
}

export function evaluateClaimRelationshipPreservation(fixtures: BenchmarkFixture[], outputText: string): DeterministicEvaluation {
  const measurements = computeA2H16Measurements(fixtures, outputText)
  return {
    passed: a2h16Passed(measurements),
    score: measurements.preservationRate,
    measurements: measurements as unknown as Record<string, unknown>,
  }
}

// ── Aggregation (pure) ───

export interface A2H16Aggregate {
  n: number
  eligibleN: number
  fixtureCount: number
  preservedCount: number
  corruptedCount: number
  uncertainCount: number
  preservationRate: number | null
}

export function aggregateA2H16(measurements: A2H16Measurements[]): A2H16Aggregate {
  const eligible = measurements.filter(m => m.eligible)
  const fixtureCount = eligible.reduce((sum, m) => sum + m.fixtureCount, 0)
  const preservedCount = eligible.reduce((sum, m) => sum + m.preservedCount, 0)
  const corruptedCount = eligible.reduce((sum, m) => sum + m.corruptedCount, 0)
  const uncertainCount = eligible.reduce((sum, m) => sum + m.uncertainCount, 0)
  return {
    n: measurements.length,
    eligibleN: eligible.length,
    fixtureCount,
    preservedCount,
    corruptedCount,
    uncertainCount,
    preservationRate: fixtureCount === 0 ? null : preservedCount / fixtureCount,
  }
}

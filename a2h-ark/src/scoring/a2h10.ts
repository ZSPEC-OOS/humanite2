// PORTED from humanite2 src/lib/a2h/a2h10.ts @ 141e366: the pure scoring core only (Firestore reporting rows/reports removed).
import type { BenchmarkFixture, DeterministicEvaluation } from '../shared/types'
import type { PreservationStatus } from '../shared/fixtureMatching'
import { summarizeProportion, type ProportionSummary } from '../shared/statistics'

export const A2H10_CODE = 'A2H-10' as const

// A2H-10 — Protected-Term Preservation (§18-19). Default behavior is exact
// preservation; allowedVariants is the only escape hatch a fixture can
// declare (§18: "Default behavior should be exact preservation unless the
// fixture explicitly defines allowed variants").
export interface ProtectedTermFixtureExpected {
  kind: string
  exactText: string
  caseSensitive: boolean
  allowedVariants: string[]
}

export interface ProtectedTermFixtureResult {
  fixtureId: string
  expected: string
  status: PreservationStatus
  observed: string[]
}

export interface A2H10Measurements {
  eligible: boolean
  fixtureCount: number
  expectedCount: number
  preservedCount: number
  missingCount: number
  modifiedCount: number
  duplicatedCount: number
  preservationRate: number | null
  fixtures: ProtectedTermFixtureResult[]
}

export function validateProtectedTermFixtureExpected(expected: Record<string, unknown>): string[] {
  const errors: string[] = []
  const kind = expected['kind']
  const exactText = expected['exactText']
  const caseSensitive = expected['caseSensitive']
  const allowedVariants = expected['allowedVariants']
  if (typeof kind !== 'string' || !kind.trim()) errors.push('kind is required.')
  if (typeof exactText !== 'string' || !exactText.trim()) errors.push('exactText is required.')
  if (typeof caseSensitive !== 'boolean') errors.push('caseSensitive must be a boolean.')
  if (allowedVariants !== undefined) {
    if (!Array.isArray(allowedVariants) || !allowedVariants.every(v => typeof v === 'string')) {
      errors.push('allowedVariants must be an array of strings.')
    } else if (new Set(allowedVariants.map(v => (caseSensitive ? v : v.toLowerCase()))).size !== allowedVariants.length) {
      errors.push('allowedVariants contains duplicates.')
    }
  }
  return errors
}

// Deterministic candidate proposal (§22) — flags common "obvious exact
// protected string" shapes: ALL-CAPS acronyms/gene symbols (CYP2D6, BRCA1),
// standard/RFC-style codes (ISO 27001, RFC 9110), and CAS-style numeric
// registry ids (64-17-5). Chemical/drug names in ordinary prose are NOT
// extracted here — recognizing those reliably needs a curated vocabulary,
// not a regex, so they're left to manual curation per §22's own guidance
// that some fixture classes need explicit curation.
export function extractProtectedTermCandidates(sourceText: string): ProtectedTermFixtureExpected[] {
  const patterns: RegExp[] = [
    /\b[A-Z]{2,6}\d[A-Z0-9]*\b/g, // CYP2D6, BRCA1
    /\b(?:ISO|RFC|IEC|ANSI)\s?\d{3,5}\b/g, // ISO 27001, RFC 9110
    /\bCAS\s?\d{2,7}-\d{2}-\d\b/gi, // CAS 64-17-5
  ]
  const seen = new Set<string>()
  const candidates: ProtectedTermFixtureExpected[] = []
  for (const pattern of patterns) {
    for (const m of sourceText.matchAll(pattern)) {
      const text = m[0]!
      if (seen.has(text)) continue
      seen.add(text)
      candidates.push({ kind: 'other_exact', exactText: text, caseSensitive: true, allowedVariants: [] })
    }
  }
  return candidates
}

function normalizeLoose(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function countExactOccurrences(haystack: string, needle: string, caseSensitive: boolean): number {
  if (!needle) return 0
  const h = caseSensitive ? haystack : haystack.toLowerCase()
  const n = caseSensitive ? needle : needle.toLowerCase()
  let count = 0
  let cursor = 0
  for (;;) {
    const found = h.indexOf(n, cursor)
    if (found === -1) break
    count++
    cursor = found + n.length
  }
  return count
}

// No fuzzy semantic matching (§18/§20): the only "modified" path is a
// whitespace/hyphen/case-only difference from exactText, never a synonym or
// paraphrase — a term replaced by unrelated wording (e.g. a full acronym
// expansion sharing no characters) is reported missing, a documented,
// conservative limitation rather than a semantic guess.
function classifyProtectedTerm(expected: ProtectedTermFixtureExpected, outputText: string): { status: PreservationStatus; observed: string[] } {
  const candidates = [expected.exactText, ...expected.allowedVariants]
  let totalExact = 0
  const observedForms: string[] = []
  for (const candidate of candidates) {
    const count = countExactOccurrences(outputText, candidate, expected.caseSensitive)
    if (count > 0) {
      totalExact += count
      observedForms.push(candidate)
    }
  }
  if (totalExact === 1) return { status: 'preserved', observed: observedForms }
  if (totalExact > 1) return { status: 'duplicated', observed: observedForms }

  const looseExpected = normalizeLoose(expected.exactText)
  if (looseExpected && normalizeLoose(outputText).includes(looseExpected)) {
    return { status: 'modified', observed: [] }
  }
  return { status: 'missing', observed: [] }
}

export function computeA2H10Measurements(fixtures: BenchmarkFixture[], outputText: string): A2H10Measurements {
  const termFixtures = fixtures.filter(f => f.type === 'protected_term')
  if (termFixtures.length === 0) {
    return {
      eligible: false, fixtureCount: 0, expectedCount: 0, preservedCount: 0, missingCount: 0,
      modifiedCount: 0, duplicatedCount: 0, preservationRate: null, fixtures: [],
    }
  }

  const sorted = [...termFixtures].sort((a, b) => a.ordinal - b.ordinal)
  const results: ProtectedTermFixtureResult[] = sorted.map(f => {
    const expected = f.expected as unknown as ProtectedTermFixtureExpected
    const { status, observed } = classifyProtectedTerm(expected, outputText)
    return { fixtureId: f.id, expected: expected.exactText, status, observed }
  })

  const countOf = (status: PreservationStatus) => results.filter(r => r.status === status).length
  const expectedCount = termFixtures.length
  const preservedCount = countOf('preserved')

  return {
    eligible: true,
    fixtureCount: expectedCount,
    expectedCount,
    preservedCount,
    missingCount: countOf('missing'),
    modifiedCount: countOf('modified'),
    duplicatedCount: countOf('duplicated'),
    preservationRate: expectedCount > 0 ? preservedCount / expectedCount : null,
    fixtures: results,
  }
}

// The pass rule (null when the source has no fixtures of this type).
export function a2h10Passed(m: A2H10Measurements): boolean | null {
  return m.eligible ? m.preservedCount === m.expectedCount : null
}

export function evaluateProtectedTerms(fixtures: BenchmarkFixture[], outputText: string): DeterministicEvaluation {
  const measurements = computeA2H10Measurements(fixtures, outputText)
  return {
    passed: a2h10Passed(measurements),
    score: measurements.preservationRate,
    measurements: measurements as unknown as Record<string, unknown>,
  }
}

// ── Aggregation (pure) ───

export interface A2H10Aggregate {
  n: number
  eligibleN: number
  fixtureCount: number
  preservationRate: ProportionSummary
  missingCount: number
  modifiedCount: number
  duplicatedCount: number
}

export function aggregateA2H10(measurements: A2H10Measurements[]): A2H10Aggregate {
  const eligible = measurements.filter(m => m.eligible)
  const totalPreserved = eligible.reduce((sum, m) => sum + m.preservedCount, 0)
  const totalExpected = eligible.reduce((sum, m) => sum + m.expectedCount, 0)
  return {
    n: measurements.length,
    eligibleN: eligible.length,
    fixtureCount: totalExpected,
    preservationRate: summarizeProportion(totalPreserved, totalExpected),
    missingCount: eligible.reduce((sum, m) => sum + m.missingCount, 0),
    modifiedCount: eligible.reduce((sum, m) => sum + m.modifiedCount, 0),
    duplicatedCount: eligible.reduce((sum, m) => sum + m.duplicatedCount, 0),
  }
}

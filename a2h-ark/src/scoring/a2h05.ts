// PORTED from humanite2 src/lib/a2h/a2h05.ts @ 141e366: the pure scoring core only (Firestore reporting rows/reports removed).
import type { BenchmarkFixture, DeterministicEvaluation } from '../shared/types'
import {
  type NumericUnitKind, type ParsedNumericValue, type NumericCandidate,
  parseNumericExpression, extractNumericCandidates,
} from '../shared/numericParser'
import { summarizeProportion, groupBy, type ProportionSummary } from '../shared/statistics'

export const A2H05_CODE = 'A2H-05' as const

// A2H-05 — Numeric & Unit Preservation (§11-13), the most rigorous
// deterministic module: every fixture carries its own structured parse
// (numericValue/unit/rangeStart.../normalizedValue) derived once from
// exactText at fixture-creation time (see validateNumericUnitFixtureExpected),
// so evaluation compares STRUCTURE, not raw string identity — "5.0" and "5"
// (same numericValue) are preserved; "5 mg" and "50 mg" (different
// numericValue) are not.
export interface NumericUnitFixtureExpected {
  kind: NumericUnitKind
  exactText: string
  numericValue: number | null
  unit: string | null
  rangeStart: number | null
  rangeEnd: number | null
  sign: '+' | '-' | null
  exponent: number | null
  normalizedValue: string
}

export type NumericFixtureStatus =
  | 'preserved' | 'missing' | 'value_changed' | 'unit_changed' | 'sign_flipped'
  | 'range_altered' | 'scientific_notation_altered' | 'version_changed'

export interface NumericFixtureResult {
  fixtureId: string
  expected: string
  status: NumericFixtureStatus
  observed: string[]
}

export interface A2H05Measurements {
  eligible: boolean
  fixtureCount: number
  expectedCount: number
  preservedCount: number
  missingCount: number
  valueChangedCount: number
  unitChangedCount: number
  signFlippedCount: number
  rangeAlteredCount: number
  scientificNotationAlteredCount: number
  versionChangedCount: number
  unexpectedCount: number
  preservationRate: number | null
  fixtures: NumericFixtureResult[]
}

const VALID_KINDS: NumericUnitKind[] = [
  'integer', 'decimal', 'percentage', 'currency', 'date', 'signed_number',
  'range', 'scientific_notation', 'value_unit', 'version_number',
]

export function validateNumericUnitFixtureExpected(expected: Record<string, unknown>): string[] {
  const errors: string[] = []
  const kind = expected['kind']
  const exactText = expected['exactText']
  const normalizedValue = expected['normalizedValue']
  if (typeof kind !== 'string' || !VALID_KINDS.includes(kind as NumericUnitKind)) {
    errors.push(`kind must be one of ${VALID_KINDS.join(', ')}.`)
    return errors
  }
  if (typeof exactText !== 'string' || !exactText.trim()) {
    errors.push('exactText is required.')
    return errors
  }
  const parsed = parseNumericExpression(kind as NumericUnitKind, exactText)
  if (!parsed) {
    errors.push(`exactText "${exactText}" does not parse as kind "${kind}".`)
    return errors
  }
  if (normalizedValue !== parsed.normalizedValue) {
    errors.push(`normalizedValue "${String(normalizedValue)}" does not match the deterministic parse of exactText ("${parsed.normalizedValue}").`)
  }
  return errors
}

// Derives the full structured shape from exactText — the single source of
// truth a fixture's numericValue/unit/rangeStart/rangeEnd/sign/exponent/
// normalizedValue are always computed from, never entered independently
// (so they can never silently disagree with exactText).
export function deriveNumericUnitFixtureExpected(kind: NumericUnitKind, exactText: string): NumericUnitFixtureExpected | null {
  const parsed = parseNumericExpression(kind, exactText)
  if (!parsed) return null
  return { kind, exactText, ...parsed }
}

export function extractNumericUnitCandidates(sourceText: string): NumericUnitFixtureExpected[] {
  const candidates: NumericUnitFixtureExpected[] = []
  const seen = new Set<string>()
  for (const kind of VALID_KINDS) {
    for (const c of extractNumericCandidates(kind, sourceText)) {
      const key = `${kind}__${c.parsed.normalizedValue}`
      if (seen.has(key)) continue
      seen.add(key)
      candidates.push({ kind, exactText: c.rawText, ...c.parsed })
    }
  }
  return candidates
}

// Priority order documented in numericParser.ts's header: range/scientific-
// notation/version-number kinds always get their own dedicated category
// (the fixture's kind alone determines what "changed" means for them);
// every other kind checks sign flip, then unit change, defaulting to
// value_changed.
function classifyChange(kind: NumericUnitKind, expected: NumericUnitFixtureExpected, observed: ParsedNumericValue): NumericFixtureStatus {
  if (kind === 'range') return 'range_altered'
  if (kind === 'scientific_notation') return 'scientific_notation_altered'
  if (kind === 'version_number') return 'version_changed'
  if (
    expected.sign != null && observed.sign != null && expected.sign !== observed.sign &&
    expected.numericValue != null && observed.numericValue != null &&
    Math.abs(expected.numericValue) === Math.abs(observed.numericValue)
  ) {
    return 'sign_flipped'
  }
  if (expected.unit != null && observed.unit != null && expected.unit.toLowerCase() !== observed.unit.toLowerCase()) {
    return 'unit_changed'
  }
  return 'value_changed'
}

function matchKindGroup(fixtures: BenchmarkFixture[], kind: NumericUnitKind, outputText: string): NumericFixtureResult[] {
  const candidates = extractNumericCandidates(kind, outputText)
  const claimed = new Set<NumericCandidate>()
  const results: NumericFixtureResult[] = []

  for (const fixture of fixtures) {
    const expected = fixture.expected as unknown as NumericUnitFixtureExpected
    const exactMatch = candidates.find(c => !claimed.has(c) && c.parsed.normalizedValue === expected.normalizedValue)
    if (exactMatch) {
      claimed.add(exactMatch)
      results.push({ fixtureId: fixture.id, expected: expected.exactText, status: 'preserved', observed: [exactMatch.rawText] })
      continue
    }
    const anyUnclaimed = candidates.find(c => !claimed.has(c))
    if (anyUnclaimed) {
      claimed.add(anyUnclaimed)
      results.push({ fixtureId: fixture.id, expected: expected.exactText, status: classifyChange(kind, expected, anyUnclaimed.parsed), observed: [anyUnclaimed.rawText] })
    } else {
      results.push({ fixtureId: fixture.id, expected: expected.exactText, status: 'missing', observed: [] })
    }
  }
  return results
}

export function computeA2H05Measurements(fixtures: BenchmarkFixture[], outputText: string): A2H05Measurements {
  const numericFixtures = fixtures.filter(f => f.type === 'numeric_unit')
  if (numericFixtures.length === 0) {
    return {
      eligible: false, fixtureCount: 0, expectedCount: 0, preservedCount: 0, missingCount: 0,
      valueChangedCount: 0, unitChangedCount: 0, signFlippedCount: 0, rangeAlteredCount: 0,
      scientificNotationAlteredCount: 0, versionChangedCount: 0, unexpectedCount: 0,
      preservationRate: null, fixtures: [],
    }
  }

  const byKind = groupBy(numericFixtures, f => (f.expected as unknown as NumericUnitFixtureExpected).kind)
  const allResults: NumericFixtureResult[] = []
  let unexpectedCount = 0
  for (const [kind, group] of byKind) {
    const sorted = [...group].sort((a, b) => a.ordinal - b.ordinal)
    const results = matchKindGroup(sorted, kind, outputText)
    allResults.push(...results)
    const candidates = extractNumericCandidates(kind, outputText)
    const claimedCount = results.filter(r => r.status !== 'missing').length
    unexpectedCount += Math.max(0, candidates.length - claimedCount)
  }

  const countOf = (status: NumericFixtureStatus) => allResults.filter(r => r.status === status).length
  const expectedCount = numericFixtures.length
  const preservedCount = countOf('preserved')

  return {
    eligible: true,
    fixtureCount: expectedCount,
    expectedCount,
    preservedCount,
    missingCount: countOf('missing'),
    valueChangedCount: countOf('value_changed'),
    unitChangedCount: countOf('unit_changed'),
    signFlippedCount: countOf('sign_flipped'),
    rangeAlteredCount: countOf('range_altered'),
    scientificNotationAlteredCount: countOf('scientific_notation_altered'),
    versionChangedCount: countOf('version_changed'),
    unexpectedCount,
    preservationRate: expectedCount > 0 ? preservedCount / expectedCount : null,
    fixtures: allResults,
  }
}

// The pass rule (null when the source has no fixtures of this type).
export function a2h05Passed(m: A2H05Measurements): boolean | null {
  return m.eligible ? m.preservedCount === m.expectedCount : null
}

export function evaluateNumericUnitPreservation(fixtures: BenchmarkFixture[], outputText: string): DeterministicEvaluation {
  const measurements = computeA2H05Measurements(fixtures, outputText)
  return {
    passed: a2h05Passed(measurements),
    score: measurements.preservationRate,
    measurements: measurements as unknown as Record<string, unknown>,
  }
}

// ── Aggregation (pure) ───

export interface A2H05Aggregate {
  n: number
  eligibleN: number
  fixtureCount: number
  preservationRate: ProportionSummary
  valueChangedCount: number
  unitChangedCount: number
  signFlippedCount: number
  rangeAlteredCount: number
  scientificNotationAlteredCount: number
  versionChangedCount: number
}

export function aggregateA2H05(measurements: A2H05Measurements[]): A2H05Aggregate {
  const eligible = measurements.filter(m => m.eligible)
  const totalPreserved = eligible.reduce((sum, m) => sum + m.preservedCount, 0)
  const totalExpected = eligible.reduce((sum, m) => sum + m.expectedCount, 0)
  return {
    n: measurements.length,
    eligibleN: eligible.length,
    fixtureCount: totalExpected,
    preservationRate: summarizeProportion(totalPreserved, totalExpected),
    valueChangedCount: eligible.reduce((sum, m) => sum + m.valueChangedCount, 0),
    unitChangedCount: eligible.reduce((sum, m) => sum + m.unitChangedCount, 0),
    signFlippedCount: eligible.reduce((sum, m) => sum + m.signFlippedCount, 0),
    rangeAlteredCount: eligible.reduce((sum, m) => sum + m.rangeAlteredCount, 0),
    scientificNotationAlteredCount: eligible.reduce((sum, m) => sum + m.scientificNotationAlteredCount, 0),
    versionChangedCount: eligible.reduce((sum, m) => sum + m.versionChangedCount, 0),
  }
}

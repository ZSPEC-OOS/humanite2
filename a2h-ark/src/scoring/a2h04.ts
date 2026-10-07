// PORTED from humanite2 src/lib/a2h/a2h04.ts @ 141e366: the pure scoring core only (Firestore reporting rows/reports removed).
import type { BenchmarkFixture, DeterministicEvaluation } from '../shared/types'
import { type CitationKind, type CitationToken, normalizeCitation, extractCitationTokens } from '../shared/citationNormalize'
import { matchFixturesAgainstObservedTokens, type PreservationStatus } from '../shared/fixtureMatching'
import { summarizeProportion, type ProportionSummary } from '../shared/statistics'

export const A2H04_CODE = 'A2H-04' as const

// A2H-04 — Citation Preservation (§9). One fixture per citation the frozen
// source contains that a Humanize transformation must preserve verbatim
// (allowing only the narrow, documented normalization in
// citationNormalize.ts) — never a fuzzy/semantic match.
export interface CitationFixtureExpected {
  kind: CitationKind
  exactText: string
  normalizedText: string
}

export interface CitationFixtureResult {
  fixtureId: string
  expected: string
  status: PreservationStatus
  observed: string[]
}

export interface A2H04Measurements {
  eligible: boolean
  fixtureCount: number
  expectedCount: number
  preservedCount: number
  missingCount: number
  modifiedCount: number
  duplicatedCount: number
  unexpectedCount: number
  preservationRate: number | null
  fixtures: CitationFixtureResult[]
}

export function validateCitationFixtureExpected(expected: Record<string, unknown>): string[] {
  const errors: string[] = []
  const kind = expected['kind']
  const exactText = expected['exactText']
  const normalizedText = expected['normalizedText']
  const validKinds: CitationKind[] = ['numeric', 'numeric_range', 'author_year', 'doi', 'figure', 'table', 'section']
  if (typeof kind !== 'string' || !validKinds.includes(kind as CitationKind)) errors.push(`kind must be one of ${validKinds.join(', ')}.`)
  if (typeof exactText !== 'string' || !exactText.trim()) errors.push('exactText is required.')
  if (typeof normalizedText !== 'string' || !normalizedText.trim()) errors.push('normalizedText is required.')
  if (typeof kind === 'string' && validKinds.includes(kind as CitationKind) && typeof exactText === 'string') {
    const expectedNormalized = normalizeCitation(kind as CitationKind, exactText)
    if (normalizedText !== expectedNormalized) {
      errors.push(`normalizedText "${String(normalizedText)}" does not match the deterministic normalization of exactText ("${expectedNormalized}").`)
    }
  }
  return errors
}

// Deterministic candidate proposal for fixture-set curation (§22) — scans
// the frozen source for recognizable citation tokens and proposes one
// candidate per distinct (kind, normalizedText) pair found. An admin
// reviews/approves candidates before they become real fixtures; nothing
// here is persisted automatically.
export function extractCitationCandidates(sourceText: string): CitationFixtureExpected[] {
  const tokens = extractCitationTokens(sourceText)
  const seen = new Set<string>()
  const candidates: CitationFixtureExpected[] = []
  for (const t of tokens) {
    const key = `${t.kind}__${t.normalizedText}`
    if (seen.has(key)) continue
    seen.add(key)
    candidates.push({ kind: t.kind, exactText: t.rawText, normalizedText: t.normalizedText })
  }
  return candidates
}

function toObservedTokens(tokens: CitationToken[]) {
  return tokens.map(t => ({ kind: t.kind, normalizedText: t.normalizedText, rawText: t.rawText }))
}

// Pure, directly unit-testable core: given a source's citation fixtures and
// an output's text, classify every fixture and detect unexpected new
// citations. Called both by evaluateCitationPreservation (the registry
// entry point) and directly by unit tests.
export function computeA2H04Measurements(fixtures: BenchmarkFixture[], outputText: string): A2H04Measurements {
  const citationFixtures = fixtures.filter(f => f.type === 'citation')
  if (citationFixtures.length === 0) {
    return {
      eligible: false, fixtureCount: 0, expectedCount: 0, preservedCount: 0, missingCount: 0,
      modifiedCount: 0, duplicatedCount: 0, unexpectedCount: 0, preservationRate: null, fixtures: [],
    }
  }

  const sorted = [...citationFixtures].sort((a, b) => a.ordinal - b.ordinal)
  const matchable = sorted.map(f => {
    const expected = f.expected as unknown as CitationFixtureExpected
    return { fixture: f, kind: expected.kind, normalizedText: expected.normalizedText }
  })
  const observed = toObservedTokens(extractCitationTokens(outputText))
  const { results, unexpected } = matchFixturesAgainstObservedTokens(matchable, observed)

  const fixtureResults: CitationFixtureResult[] = results.map(r => ({
    fixtureId: r.fixture.id,
    expected: (r.fixture.expected as unknown as CitationFixtureExpected).exactText,
    status: r.status,
    observed: r.observed,
  }))

  const preservedCount = fixtureResults.filter(r => r.status === 'preserved').length
  const missingCount = fixtureResults.filter(r => r.status === 'missing').length
  const modifiedCount = fixtureResults.filter(r => r.status === 'modified').length
  const duplicatedCount = fixtureResults.filter(r => r.status === 'duplicated').length
  const expectedCount = citationFixtures.length

  return {
    eligible: true,
    fixtureCount: expectedCount,
    expectedCount,
    preservedCount,
    missingCount,
    modifiedCount,
    duplicatedCount,
    unexpectedCount: unexpected.length,
    preservationRate: expectedCount > 0 ? preservedCount / expectedCount : null,
    fixtures: fixtureResults,
  }
}

// The pass rule (null when the source has no fixtures of this type).
export function a2h04Passed(m: A2H04Measurements): boolean | null {
  return m.eligible ? m.missingCount === 0 && m.modifiedCount === 0 && m.duplicatedCount === 0 : null
}

export function evaluateCitationPreservation(fixtures: BenchmarkFixture[], outputText: string): DeterministicEvaluation {
  const measurements = computeA2H04Measurements(fixtures, outputText)
  return {
    passed: a2h04Passed(measurements),
    score: measurements.preservationRate,
    measurements: measurements as unknown as Record<string, unknown>,
  }
}

// ── Aggregation (pure) ───

export interface A2H04Aggregate {
  n: number
  eligibleN: number
  fixtureCount: number
  preservationRate: ProportionSummary
  missingCount: number
  modifiedCount: number
  duplicatedCount: number
  unexpectedCount: number
}

// Primary denominator is eligible-only (§29/§37): ineligible (zero-fixture)
// rows never count toward the preservation rate or its confidence interval.
export function aggregateA2H04(measurements: A2H04Measurements[]): A2H04Aggregate {
  const eligible = measurements.filter(m => m.eligible)
  const preserved = eligible.filter(m => m.preservedCount === m.expectedCount && m.expectedCount > 0).length
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
    unexpectedCount: eligible.reduce((sum, m) => sum + m.unexpectedCount, 0),
  }
}

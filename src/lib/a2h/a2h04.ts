import type { Firestore } from 'firebase-admin/firestore'
import type { Domain } from '@/lib/style/types'
import type { BenchmarkFixture, DeterministicTestContext, DeterministicEvaluation } from './types'
import { type CitationKind, type CitationToken, normalizeCitation, extractCitationTokens } from './citationNormalize'
import { matchFixturesAgainstObservedTokens, type PreservationStatus } from './fixtureMatching'
import { summarizeProportion, groupBy, type ProportionSummary } from './statistics'
import { listTestResultsForRun } from './testResults'
import { listOutputsForRun } from './outputs'

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

export function evaluateCitationPreservation(ctx: DeterministicTestContext): DeterministicEvaluation {
  const measurements = computeA2H04Measurements(ctx.fixtures, ctx.output.outputText)
  return {
    passed: measurements.eligible ? measurements.missingCount === 0 && measurements.modifiedCount === 0 && measurements.duplicatedCount === 0 : null,
    score: measurements.preservationRate,
    measurements: measurements as unknown as Record<string, unknown>,
  }
}

// ── Reporting (mirrors a2h01.ts/a2h02.ts's Row/Filters/Report pattern) ───

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

export interface A2H04Row {
  sourceId: string
  outputId: string
  domainId: Domain
  topicId: string
  targetWords: number
  intensity: number
  measurements: A2H04Measurements
}

export interface A2H04Filters {
  domainId?: Domain
  topicId?: string
  targetWords?: number
  intensity?: number
}

function matchesFilters(row: A2H04Row, filters?: A2H04Filters): boolean {
  if (!filters) return true
  if (filters.domainId && row.domainId !== filters.domainId) return false
  if (filters.topicId && row.topicId !== filters.topicId) return false
  if (filters.targetWords != null && row.targetWords !== filters.targetWords) return false
  if (filters.intensity != null && row.intensity !== filters.intensity) return false
  return true
}

export async function getA2H04Rows(firestore: Firestore, runId: string, filters?: A2H04Filters): Promise<A2H04Row[]> {
  const [testResults, outputs] = await Promise.all([
    listTestResultsForRun(firestore, runId, A2H04_CODE),
    listOutputsForRun(firestore, runId),
  ])
  const outputsById = new Map(outputs.map(o => [o.id, o]))
  const rows: A2H04Row[] = []
  for (const tr of testResults) {
    if (!tr.outputId) continue
    const output = outputsById.get(tr.outputId)
    if (!output) continue
    const row: A2H04Row = {
      sourceId: tr.sourceId,
      outputId: tr.outputId,
      domainId: output.domainId,
      topicId: output.topicId,
      targetWords: output.targetWords,
      intensity: output.intensity,
      measurements: tr.measurements as unknown as A2H04Measurements,
    }
    if (matchesFilters(row, filters)) rows.push(row)
  }
  return rows
}

export interface A2H04Report {
  overall: A2H04Aggregate
  byDomain: Record<string, A2H04Aggregate>
  byLength: Record<number, A2H04Aggregate>
  byIntensity: Record<number, A2H04Aggregate>
  rows: A2H04Row[]
}

function groupedAggregate<K extends string | number>(rows: A2H04Row[], keyFn: (row: A2H04Row) => K): Record<K, A2H04Aggregate> {
  const groups = groupBy(rows, keyFn)
  const result = {} as Record<K, A2H04Aggregate>
  for (const [key, group] of groups) result[key] = aggregateA2H04(group.map(r => r.measurements))
  return result
}

export async function getA2H04Report(firestore: Firestore, runId: string, filters?: A2H04Filters): Promise<A2H04Report> {
  const rows = await getA2H04Rows(firestore, runId, filters)
  return {
    overall: aggregateA2H04(rows.map(r => r.measurements)),
    byDomain: groupedAggregate(rows, r => r.domainId),
    byLength: groupedAggregate(rows, r => r.targetWords),
    byIntensity: groupedAggregate(rows, r => r.intensity),
    rows,
  }
}

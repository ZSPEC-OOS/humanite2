// PORTED from humanite2 src/lib/a2h/a2h13.ts @ 141e366: the pure scoring core only (Firestore reporting rows/reports removed).
import type { BenchmarkFixture, DeterministicEvaluation } from '../shared/types'
import { summarizeProportion, type ProportionSummary } from '../shared/statistics'

export const A2H13_CODE = 'A2H-13' as const

// A2H-13 — Terminology Consistency (§20-21): repeated controlled
// terminology across a (typically longer) output. Unlike A2H-04/05/09/10,
// this measures every OCCURRENCE of the controlled term, not a fixed count
// of expected fixtures — a single fixture can govern dozens of occurrences.
export interface TerminologyFixtureExpected {
  preferredTerm: string
  allowedVariants: string[]
  forbiddenVariants: string[]
  caseSensitive: boolean
  expectedMinimumOccurrences: number | null
}

export interface TerminologyFixtureResult {
  fixtureId: string
  preferredTerm: string
  preferredCount: number
  allowedVariantCount: number
  forbiddenVariantCount: number
  unexpectedVariantCount: number
  consistentCount: number
  controlledCount: number
}

export interface A2H13Measurements {
  eligible: boolean
  fixtureCount: number
  controlledOccurrenceCount: number
  consistentOccurrenceCount: number
  preferredCount: number
  allowedVariantCount: number
  forbiddenVariantCount: number
  unexpectedVariantCount: number
  consistencyRate: number | null
  terminology: TerminologyFixtureResult[]
}

export function validateTerminologyFixtureExpected(expected: Record<string, unknown>): string[] {
  const errors: string[] = []
  const preferredTerm = expected['preferredTerm']
  const allowedVariants = expected['allowedVariants']
  const forbiddenVariants = expected['forbiddenVariants']
  const caseSensitive = expected['caseSensitive']
  if (typeof preferredTerm !== 'string' || !preferredTerm.trim()) errors.push('preferredTerm is required.')
  if (typeof caseSensitive !== 'boolean') errors.push('caseSensitive must be a boolean.')
  for (const [field, value] of [['allowedVariants', allowedVariants], ['forbiddenVariants', forbiddenVariants]] as const) {
    if (value !== undefined) {
      if (!Array.isArray(value) || !value.every(v => typeof v === 'string')) errors.push(`${field} must be an array of strings.`)
      else if (new Set(value.map(v => v.toLowerCase())).size !== value.length) errors.push(`${field} contains duplicates.`)
    }
  }
  if (Array.isArray(allowedVariants) && Array.isArray(forbiddenVariants)) {
    const overlap = allowedVariants.filter((v: string) => forbiddenVariants.some((f: string) => f.toLowerCase() === v.toLowerCase()))
    if (overlap.length > 0) errors.push(`allowedVariants and forbiddenVariants overlap: ${overlap.join(', ')}.`)
  }
  return errors
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function countExact(text: string, term: string, caseSensitive: boolean): number {
  const re = new RegExp(`\\b${escapeRegExp(term)}\\b`, caseSensitive ? 'g' : 'gi')
  return [...text.matchAll(re)].length
}

// Forbidden synonyms are forbidden regardless of case — always checked
// case-insensitively, independent of the fixture's own caseSensitive flag
// (which governs the PREFERRED term/allowed-variant comparison only).
function countForbidden(text: string, term: string): number {
  const re = new RegExp(`\\b${escapeRegExp(term)}\\b`, 'gi')
  return [...text.matchAll(re)].length
}

// "Unexpected variant" (§21) is deterministically scoped to a near-miss of
// the SAME declared string — a case difference (when caseSensitive is true)
// or a simple trailing-s pluralization — never an unrelated synonym, which
// this module has no way to recognize without semantic understanding. A
// loose case-insensitive/optional-plural scan finds every candidate
// occurrence; whichever ones also satisfy the exact caseSensitive rule are
// "preferred"/"allowed", and the remainder are "unexpected".
function countLooseCandidates(text: string, term: string): number {
  const re = new RegExp(`\\b${escapeRegExp(term)}s?\\b`, 'gi')
  return [...text.matchAll(re)].length
}

function evaluateTerm(expected: TerminologyFixtureExpected, outputText: string): { preferred: number; allowed: number; unexpected: number } {
  const looseTotal = countLooseCandidates(outputText, expected.preferredTerm)
  const exactPreferred = countExact(outputText, expected.preferredTerm, expected.caseSensitive)
  let allowed = 0
  for (const variant of expected.allowedVariants) allowed += countExact(outputText, variant, expected.caseSensitive)
  const looseAllowed = expected.allowedVariants.reduce((sum, v) => sum + countLooseCandidates(outputText, v), 0)
  const unexpected = Math.max(0, (looseTotal - exactPreferred) + (looseAllowed - allowed))
  return { preferred: exactPreferred, allowed, unexpected }
}

export function computeA2H13Measurements(fixtures: BenchmarkFixture[], outputText: string): A2H13Measurements {
  const termFixtures = fixtures.filter(f => f.type === 'terminology')
  if (termFixtures.length === 0) {
    return {
      eligible: false, fixtureCount: 0, controlledOccurrenceCount: 0, consistentOccurrenceCount: 0,
      preferredCount: 0, allowedVariantCount: 0, forbiddenVariantCount: 0, unexpectedVariantCount: 0,
      consistencyRate: null, terminology: [],
    }
  }

  const sorted = [...termFixtures].sort((a, b) => a.ordinal - b.ordinal)
  const terminology: TerminologyFixtureResult[] = sorted.map(f => {
    const expected = f.expected as unknown as TerminologyFixtureExpected
    const { preferred, allowed, unexpected } = evaluateTerm(expected, outputText)
    const forbidden = expected.forbiddenVariants.reduce((sum, v) => sum + countForbidden(outputText, v), 0)
    return {
      fixtureId: f.id,
      preferredTerm: expected.preferredTerm,
      preferredCount: preferred,
      allowedVariantCount: allowed,
      forbiddenVariantCount: forbidden,
      unexpectedVariantCount: unexpected,
      consistentCount: preferred + allowed,
      controlledCount: preferred + allowed + forbidden + unexpected,
    }
  })

  const sum = (fn: (t: TerminologyFixtureResult) => number) => terminology.reduce((s, t) => s + fn(t), 0)
  const controlledOccurrenceCount = sum(t => t.controlledCount)
  const consistentOccurrenceCount = sum(t => t.consistentCount)

  return {
    eligible: true,
    fixtureCount: termFixtures.length,
    controlledOccurrenceCount,
    consistentOccurrenceCount,
    preferredCount: sum(t => t.preferredCount),
    allowedVariantCount: sum(t => t.allowedVariantCount),
    forbiddenVariantCount: sum(t => t.forbiddenVariantCount),
    unexpectedVariantCount: sum(t => t.unexpectedVariantCount),
    consistencyRate: controlledOccurrenceCount > 0 ? consistentOccurrenceCount / controlledOccurrenceCount : null,
    terminology,
  }
}

// The pass rule (null when the source has no fixtures of this type).
export function a2h13Passed(m: A2H13Measurements): boolean | null {
  return m.eligible ? m.forbiddenVariantCount === 0 && m.unexpectedVariantCount === 0 : null
}

export function evaluateTerminologyConsistency(fixtures: BenchmarkFixture[], outputText: string): DeterministicEvaluation {
  const measurements = computeA2H13Measurements(fixtures, outputText)
  return {
    passed: a2h13Passed(measurements),
    score: measurements.consistencyRate,
    measurements: measurements as unknown as Record<string, unknown>,
  }
}

// ── Aggregation (pure) ───

export interface A2H13Aggregate {
  n: number
  eligibleN: number
  controlledOccurrenceCount: number
  consistencyRate: ProportionSummary
  forbiddenVariantCount: number
  unexpectedVariantCount: number
}

export function aggregateA2H13(measurements: A2H13Measurements[]): A2H13Aggregate {
  const eligible = measurements.filter(m => m.eligible)
  const totalConsistent = eligible.reduce((sum, m) => sum + m.consistentOccurrenceCount, 0)
  const totalControlled = eligible.reduce((sum, m) => sum + m.controlledOccurrenceCount, 0)
  return {
    n: measurements.length,
    eligibleN: eligible.length,
    controlledOccurrenceCount: totalControlled,
    consistencyRate: summarizeProportion(totalConsistent, totalControlled),
    forbiddenVariantCount: eligible.reduce((sum, m) => sum + m.forbiddenVariantCount, 0),
    unexpectedVariantCount: eligible.reduce((sum, m) => sum + m.unexpectedVariantCount, 0),
  }
}

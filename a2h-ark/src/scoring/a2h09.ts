// PORTED from humanite2 src/lib/a2h/a2h09.ts @ 141e366: the pure scoring core only (Firestore reporting rows/reports removed).
import type { BenchmarkFixture, DeterministicEvaluation } from '../shared/types'
import { summarizeProportion, type ProportionSummary } from '../shared/statistics'

export const A2H09_CODE = 'A2H-09' as const

export type ModalityCategory = 'negation' | 'necessity' | 'recommendation' | 'permission' | 'possibility' | 'likelihood' | 'prohibition'

// The fixed controlled vocabulary this module recognizes (§15) — evaluation
// never scores a modal word outside this list plus a fixture's own
// approvedEquivalentForms.
export const MODALITY_VOCABULARY: readonly string[] = [
  'not', 'never', 'cannot', "can't", 'must not', 'must', 'should not', 'should',
  'may', 'might', 'could', 'likely', 'unlikely', 'required to', 'permitted to', 'prohibited from',
]

// A2H-09 — Negation & Modality Preservation (§15-17). Binding is anchor-based
// (§16): a fixture's anchorText locates the sentence-local context in the
// OUTPUT before any modal-word comparison happens, so a global word count
// can never satisfy this test — the modal word must still be attached to
// the same claim, not merely present anywhere in the document.
export interface ModalityFixtureExpected {
  exactText: string
  category: ModalityCategory
  strength: number
  approvedEquivalentForms: string[]
  anchorText: string | null
}

export type ModalityStatus = 'preserved' | 'missing' | 'reversed' | 'strengthened' | 'weakened'

export interface ModalityFixtureResult {
  fixtureId: string
  expected: string
  status: ModalityStatus
  observed: string[]
}

export interface A2H09Measurements {
  eligible: boolean
  fixtureCount: number
  expectedCount: number
  preservedCount: number
  missingCount: number
  reversedCount: number
  strengthenedCount: number
  weakenedCount: number
  preservationRate: number | null
  fixtures: ModalityFixtureResult[]
}

const VALID_CATEGORIES: ModalityCategory[] = ['negation', 'necessity', 'recommendation', 'permission', 'possibility', 'likelihood', 'prohibition']

export function validateModalityFixtureExpected(expected: Record<string, unknown>): string[] {
  const errors: string[] = []
  const exactText = expected['exactText']
  const category = expected['category']
  const strength = expected['strength']
  const approvedEquivalentForms = expected['approvedEquivalentForms']
  if (typeof exactText !== 'string' || !exactText.trim()) errors.push('exactText is required.')
  if (typeof category !== 'string' || !VALID_CATEGORIES.includes(category as ModalityCategory)) errors.push(`category must be one of ${VALID_CATEGORIES.join(', ')}.`)
  if (typeof strength !== 'number' || !Number.isFinite(strength)) errors.push('strength must be a number.')
  if (approvedEquivalentForms !== undefined) {
    if (!Array.isArray(approvedEquivalentForms) || !approvedEquivalentForms.every(v => typeof v === 'string')) {
      errors.push('approvedEquivalentForms must be an array of strings.')
    } else if (new Set(approvedEquivalentForms.map(v => v.toLowerCase())).size !== approvedEquivalentForms.length) {
      errors.push('approvedEquivalentForms contains duplicates.')
    }
  }
  return errors
}

// Proposes one candidate per controlled-vocabulary occurrence found verbatim
// in the frozen source, with a short surrounding phrase as anchorText —
// category/strength/approvedEquivalentForms are left for the admin to set,
// since a bare word match can't determine those.
export function extractModalityCandidates(sourceText: string): Array<{ exactText: string; anchorText: string }> {
  const sorted = [...MODALITY_VOCABULARY].sort((a, b) => b.length - a.length)
  const escaped = sorted.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const re = new RegExp(`\\b(${escaped.join('|')})\\b`, 'gi')
  const candidates: Array<{ exactText: string; anchorText: string }> = []
  for (const m of sourceText.matchAll(re)) {
    const start = Math.max(0, m.index! - 30)
    const end = Math.min(sourceText.length, m.index! + m[0]!.length + 30)
    candidates.push({ exactText: m[0]!, anchorText: sourceText.slice(start, end).trim() })
  }
  return candidates
}

// Documented reversal pairs: a negative-pole term and the positive-pole term
// that directly negates/undoes it. Symmetric (checked both directions).
const REVERSAL_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['must not', 'must'],
  ['should not', 'should'],
  ['prohibited from', 'permitted to'],
  ['likely', 'unlikely'],
]

function isReversalPair(a: string, b: string): boolean {
  return REVERSAL_PAIRS.some(([x, y]) => (x === a && y === b) || (x === b && y === a))
}

// Strength axes (§15's documented example: might < may < should < must) —
// deliberately grouped families, never one universal scale (§15: "do not
// force incomparable categories into a single scale"). 'negation' has no
// strength axis at all; its only outcomes are preserved/missing/reversed.
const NECESSITY_FAMILY: Record<string, number> = { might: 1, could: 1, may: 2, should: 3, must: 4, 'required to': 4 }
const LIKELIHOOD_FAMILY: Record<string, number> = { unlikely: 1, likely: 2 }
const PERMISSION_FAMILY: Record<string, number> = { 'prohibited from': 1, 'permitted to': 2 }

function familyStrengthTable(category: ModalityCategory): Record<string, number> | null {
  if (category === 'necessity' || category === 'recommendation' || category === 'possibility') return NECESSITY_FAMILY
  if (category === 'likelihood') return LIKELIHOOD_FAMILY
  if (category === 'permission' || category === 'prohibition') return PERMISSION_FAMILY
  return null
}

function findAnchorWindow(outputText: string, anchorText: string | null): string | null {
  if (!anchorText || !anchorText.trim()) return outputText
  const idx = outputText.toLowerCase().indexOf(anchorText.trim().toLowerCase())
  if (idx === -1) return null
  const start = Math.max(0, idx - 60)
  const end = Math.min(outputText.length, idx + anchorText.trim().length + 60)
  return outputText.slice(start, end)
}

function findVocabularyMatch(window: string, extraTerms: string[]): string | null {
  const terms = [...MODALITY_VOCABULARY, ...extraTerms]
  const sorted = [...new Set(terms)].sort((a, b) => b.length - a.length)
  const escaped = sorted.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const re = new RegExp(`\\b(${escaped.join('|')})\\b`, 'i')
  const m = re.exec(window)
  return m ? m[0] : null
}

function classifyModality(expected: ModalityFixtureExpected, outputText: string): { status: ModalityStatus; observed: string[] } {
  const window = findAnchorWindow(outputText, expected.anchorText)
  if (window == null) return { status: 'missing', observed: [] }

  const matched = findVocabularyMatch(window, expected.approvedEquivalentForms)
  if (matched == null) {
    // No modal/negation word at all in the bound context: for a negation
    // or prohibition fixture this means the claim's polarity flipped
    // (§16's "did not increase" -> "increased" example); for every other
    // category it means the modal expression was simply dropped.
    const status: ModalityStatus = expected.category === 'negation' || expected.category === 'prohibition' ? 'reversed' : 'missing'
    return { status, observed: [] }
  }

  const fixtureWord = expected.exactText.toLowerCase()
  const observedWord = matched.toLowerCase()
  if (observedWord === fixtureWord || expected.approvedEquivalentForms.some(v => v.toLowerCase() === observedWord)) {
    return { status: 'preserved', observed: [matched] }
  }
  if (isReversalPair(fixtureWord, observedWord)) return { status: 'reversed', observed: [matched] }

  const table = familyStrengthTable(expected.category)
  if (table && table[fixtureWord] != null && table[observedWord] != null) {
    const delta = table[observedWord]! - table[fixtureWord]!
    if (delta > 0) return { status: 'strengthened', observed: [matched] }
    if (delta < 0) return { status: 'weakened', observed: [matched] }
    return { status: 'preserved', observed: [matched] }
  }

  // A vocabulary word IS present but shares no documented relationship with
  // the expected one — an incompatible substitution, treated as a meaning
  // distortion severe enough to flag (documented fallback; §17 has no
  // "modified" bucket for this test).
  return { status: 'reversed', observed: [matched] }
}

export function computeA2H09Measurements(fixtures: BenchmarkFixture[], outputText: string): A2H09Measurements {
  const modalityFixtures = fixtures.filter(f => f.type === 'modality')
  if (modalityFixtures.length === 0) {
    return {
      eligible: false, fixtureCount: 0, expectedCount: 0, preservedCount: 0, missingCount: 0,
      reversedCount: 0, strengthenedCount: 0, weakenedCount: 0, preservationRate: null, fixtures: [],
    }
  }

  const sorted = [...modalityFixtures].sort((a, b) => a.ordinal - b.ordinal)
  const results: ModalityFixtureResult[] = sorted.map(f => {
    const expected = f.expected as unknown as ModalityFixtureExpected
    const { status, observed } = classifyModality(expected, outputText)
    return { fixtureId: f.id, expected: expected.exactText, status, observed }
  })

  const countOf = (status: ModalityStatus) => results.filter(r => r.status === status).length
  const expectedCount = modalityFixtures.length
  const preservedCount = countOf('preserved')

  return {
    eligible: true,
    fixtureCount: expectedCount,
    expectedCount,
    preservedCount,
    missingCount: countOf('missing'),
    reversedCount: countOf('reversed'),
    strengthenedCount: countOf('strengthened'),
    weakenedCount: countOf('weakened'),
    preservationRate: expectedCount > 0 ? preservedCount / expectedCount : null,
    fixtures: results,
  }
}

// The pass rule (null when the source has no fixtures of this type).
export function a2h09Passed(m: A2H09Measurements): boolean | null {
  return m.eligible ? m.preservedCount === m.expectedCount : null
}

export function evaluateModalityPreservation(fixtures: BenchmarkFixture[], outputText: string): DeterministicEvaluation {
  const measurements = computeA2H09Measurements(fixtures, outputText)
  return {
    passed: a2h09Passed(measurements),
    score: measurements.preservationRate,
    measurements: measurements as unknown as Record<string, unknown>,
  }
}

// ── Aggregation (pure) ───

export interface A2H09Aggregate {
  n: number
  eligibleN: number
  fixtureCount: number
  preservationRate: ProportionSummary
  reversedCount: number
  strengthenedCount: number
  weakenedCount: number
}

export function aggregateA2H09(measurements: A2H09Measurements[]): A2H09Aggregate {
  const eligible = measurements.filter(m => m.eligible)
  const totalPreserved = eligible.reduce((sum, m) => sum + m.preservedCount, 0)
  const totalExpected = eligible.reduce((sum, m) => sum + m.expectedCount, 0)
  return {
    n: measurements.length,
    eligibleN: eligible.length,
    fixtureCount: totalExpected,
    preservationRate: summarizeProportion(totalPreserved, totalExpected),
    reversedCount: eligible.reduce((sum, m) => sum + m.reversedCount, 0),
    strengthenedCount: eligible.reduce((sum, m) => sum + m.strengthenedCount, 0),
    weakenedCount: eligible.reduce((sum, m) => sum + m.weakenedCount, 0),
  }
}

// Ported from humanite2 src/lib/a2h/a2h12.ts @ 141e366. Firestore reporting removed; repairChunk call split into plan/measure.
import type { TargetCall, TargetCallResult } from '../shared/targetCalls'
import { summarizeProportion, groupBy, type ProportionSummary } from '../shared/statistics'
import { type NumericUnitKind, parseNumericExpression, extractNumericCandidates } from '../shared/numericParser'

export const A2H12_CODE = 'A2H-12' as const

// A2H-12 — Factual Repair Success (§17-21, §34-35). Like A2H-06, this is
// FIXTURE-scoped (no BenchmarkOutput): each factual_repair fixture is a
// known corruption of a clean ground-truth passage, repaired via
// repairChunk (evaluation/repair.ts — the SAME fact-ledger-gated targeted
// repair the production Humanize pipeline already uses, §21), then scored
// deterministically against the fixture's own recorded ground truth/
// corrupted values (§34) — never by an LLM judge.
export type FactualCorruptionCategory =
  | 'numeric_substitution' | 'unit_substitution' | 'negation_deletion' | 'modality_change'
  | 'comparator_reversal' | 'sign_reversal' | 'range_corruption' | 'scientific_notation_corruption'
  | 'version_change' | 'entity_substitution' | 'cross_reference_swap' | 'relationship_binding_change'

export interface FactualRepairFixtureExpected {
  cleanText: string
  corruptedText: string
  category: FactualCorruptionCategory
  expectedGroundTruth: string[]
  corruptedValues: string[]
  anchorText: string | null
}

// §20's eleven adversarial cases, ported (re-authored, not imported —
// §44: never import a tests/ file into runtime) as production A2H-12
// regression fixtures. expectedGroundTruth entries are the full corrected
// CLAUSE, not just the bare value, wherever binding to a specific entity
// or position matters (§35's negative tests) — "Server Alpha runs firmware
// 2.1" as one string is what actually proves correct binding, not the
// substring "2.1" appearing somewhere in the text.
export const INITIAL_FACTUAL_FIXTURES: FactualRepairFixtureExpected[] = [
  { cleanText: 'Store the sample at 5 mg per vial.', corruptedText: 'Store the sample at 50 mg per vial.', category: 'numeric_substitution', expectedGroundTruth: ['5 mg'], corruptedValues: ['50 mg'], anchorText: 'per vial' },
  { cleanText: 'The shipment weighs 5 kilograms and costs 200 dollars.', corruptedText: 'The shipment weighs 5 kilograms and costs 200 euros.', category: 'unit_substitution', expectedGroundTruth: ['200 dollars'], corruptedValues: ['200 euros'], anchorText: '5 kilograms' },
  { cleanText: 'Patients may discontinue the medication after 7 days.', corruptedText: 'Patients must discontinue the medication after 7 days.', category: 'modality_change', expectedGroundTruth: ['may discontinue'], corruptedValues: ['must discontinue'], anchorText: 'after 7 days' },
  { cleanText: 'The results did not increase significantly.', corruptedText: 'The results increased significantly.', category: 'negation_deletion', expectedGroundTruth: ['did not increase'], corruptedValues: ['increased'], anchorText: 'significantly' },
  { cleanText: 'Statistical analysis of the outcome yielded p > 0.05.', corruptedText: 'Statistical analysis of the outcome yielded p < 0.05.', category: 'comparator_reversal', expectedGroundTruth: ['p > 0.05'], corruptedValues: ['p < 0.05'], anchorText: 'Statistical analysis' },
  { cleanText: 'Revenue changed by +5% year over year.', corruptedText: 'Revenue changed by -5% year over year.', category: 'sign_reversal', expectedGroundTruth: ['+5%'], corruptedValues: ['-5%'], anchorText: 'year over year' },
  { cleanText: 'The dosing range spans from 5 mg to 20 mg.', corruptedText: 'The dosing range spans from 20 mg to 5 mg.', category: 'range_corruption', expectedGroundTruth: ['5 mg to 20 mg'], corruptedValues: ['20 mg to 5 mg'], anchorText: 'dosing range' },
  { cleanText: 'The measured concentration was 3.2 x 10^-4 mol/L.', corruptedText: 'The measured concentration was 3.2 x 10^4 mol/L.', category: 'scientific_notation_corruption', expectedGroundTruth: ['10^-4'], corruptedValues: ['10^4'], anchorText: 'mol/L' },
  { cleanText: 'Server Alpha runs firmware 2.1; Server Beta runs firmware 3.4.', corruptedText: 'Server Alpha runs firmware 3.4; Server Beta runs firmware 2.1.', category: 'relationship_binding_change', expectedGroundTruth: ['Server Alpha runs firmware 2.1', 'Server Beta runs firmware 3.4'], corruptedValues: ['Server Alpha runs firmware 3.4', 'Server Beta runs firmware 2.1'], anchorText: null },
  { cleanText: 'See Section 4 for methodology and Section 9 for results.', corruptedText: 'See Section 9 for methodology and Section 4 for results.', category: 'cross_reference_swap', expectedGroundTruth: ['Section 4 for methodology', 'Section 9 for results'], corruptedValues: ['Section 9 for methodology', 'Section 4 for results'], anchorText: null },
  { cleanText: 'Compound A showed higher potency than Compound B in the assay.', corruptedText: 'Compound B showed higher potency than Compound A in the assay.', category: 'entity_substitution', expectedGroundTruth: ['Compound A showed higher potency than Compound B'], corruptedValues: ['Compound B showed higher potency than Compound A'], anchorText: null },
]

export function validateFactualRepairFixtureExpected(expected: Record<string, unknown>): string[] {
  const errors: string[] = []
  const validCategories: FactualCorruptionCategory[] = [
    'numeric_substitution', 'unit_substitution', 'negation_deletion', 'modality_change', 'comparator_reversal',
    'sign_reversal', 'range_corruption', 'scientific_notation_corruption', 'version_change', 'entity_substitution',
    'cross_reference_swap', 'relationship_binding_change',
  ]
  const cleanText = expected['cleanText']
  const corruptedText = expected['corruptedText']
  const category = expected['category']
  const expectedGroundTruth = expected['expectedGroundTruth']
  const corruptedValues = expected['corruptedValues']
  if (typeof cleanText !== 'string' || !cleanText.trim()) errors.push('cleanText is required.')
  if (typeof corruptedText !== 'string' || !corruptedText.trim()) errors.push('corruptedText is required.')
  if (typeof category !== 'string' || !validCategories.includes(category as FactualCorruptionCategory)) errors.push(`category must be one of ${validCategories.join(', ')}.`)
  if (!Array.isArray(expectedGroundTruth) || expectedGroundTruth.length === 0 || !expectedGroundTruth.every(v => typeof v === 'string' && v.trim())) {
    errors.push('expectedGroundTruth must be a non-empty array of non-empty strings.')
  }
  if (!Array.isArray(corruptedValues) || !corruptedValues.every(v => typeof v === 'string')) {
    errors.push('corruptedValues must be an array of strings.')
  }
  if (typeof cleanText === 'string' && Array.isArray(expectedGroundTruth)) {
    for (const gt of expectedGroundTruth) if (typeof gt === 'string' && !cleanText.includes(gt)) errors.push(`expectedGroundTruth "${gt}" does not appear verbatim in cleanText.`)
  }
  if (typeof corruptedText === 'string' && Array.isArray(corruptedValues)) {
    for (const cv of corruptedValues) if (typeof cv === 'string' && !corruptedText.includes(cv)) errors.push(`corruptedValues "${cv}" does not appear verbatim in corruptedText.`)
  }
  return errors
}

// Deterministic candidate proposal (§30) is limited to the curated
// INITIAL_FACTUAL_FIXTURES seed set for the same reason as a2h06's proposer
// — generating novel factual corruptions automatically risks an ambiguous
// or simply wrong "ground truth" (§30: "only create a corruption when the
// clean ground truth is unambiguous"). An admin reviews and approves each
// one; nothing is auto-locked.
export function proposeFactualRepairCandidates(): FactualRepairFixtureExpected[] {
  return INITIAL_FACTUAL_FIXTURES.map(f => ({ ...f }))
}

// A boundary-safe "does this exact phrase appear" check — plain
// `.includes()` would wrongly match "5 mg" inside "25 mg" or "50 mg"
// containing it as a substring; this requires the character immediately
// before/after the match (if any) to be non-alphanumeric.
function containsExact(haystack: string, needle: string): boolean {
  if (!needle) return false
  let from = 0
  while (true) {
    const idx = haystack.indexOf(needle, from)
    if (idx === -1) return false
    const before = idx > 0 ? haystack[idx - 1]! : ''
    const after = idx + needle.length < haystack.length ? haystack[idx + needle.length]! : ''
    const boundaryOk = (c: string) => !c || !/[a-zA-Z0-9]/.test(c)
    if (boundaryOk(before) && boundaryOk(after)) return true
    from = idx + 1
  }
}

function findWindow(text: string, anchorText: string | null): string {
  if (!anchorText || !anchorText.trim()) return text
  const idx = text.toLowerCase().indexOf(anchorText.trim().toLowerCase())
  if (idx === -1) return ''
  const start = Math.max(0, idx - 80)
  const end = Math.min(text.length, idx + anchorText.length + 80)
  return text.slice(start, end)
}

// Numeric-ish categories reuse A2H-05's parser (§18/§34) to additionally
// check for a "new corruption" — a numeric-shaped value in the window that
// matches neither the ground truth nor the known corrupted value (e.g. the
// repair landed on a THIRD wrong number). Every other category has no
// natural existing parser to reuse and relies on the exact-phrase check
// alone.
const NUMERIC_KIND_CANDIDATES: NumericUnitKind[] = ['value_unit', 'percentage', 'currency', 'integer', 'decimal', 'signed_number', 'scientific_notation', 'range', 'version_number']

function inferNumericKind(text: string): NumericUnitKind | null {
  for (const kind of NUMERIC_KIND_CANDIDATES) {
    if (parseNumericExpression(kind, text)) return kind
  }
  return null
}

function detectNewNumericCorruption(fixture: FactualRepairFixtureExpected, window: string): boolean {
  const kind = inferNumericKind(fixture.expectedGroundTruth[0] ?? '')
  if (!kind) return false
  const candidates = extractNumericCandidates(kind, window)
  // "Known legitimate" includes every numeric value already present in the
  // CLEAN ground truth (e.g. "5 kilograms" alongside a "200 dollars" target
  // — unrelated, unchanged content, not evidence of a new corruption) plus
  // the fixture's own corrupted value.
  const knownNormalized = new Set([
    ...extractNumericCandidates(kind, fixture.cleanText).map(c => c.parsed.normalizedValue),
    ...fixture.corruptedValues.map(cv => parseNumericExpression(kind, cv)?.normalizedValue).filter((v): v is string => v != null),
  ])
  return candidates.some(c => !knownNormalized.has(c.parsed.normalizedValue))
}

export type FactualRepairStatus = 'fully_repaired' | 'partially_repaired' | 'not_repaired' | 'new_corruption'

export interface FactualRepairFixtureResult {
  fixtureId: string
  category: FactualCorruptionCategory
  status: FactualRepairStatus
  presentGroundTruth: string[]
  presentCorrupted: string[]
  /** Humanite persisted a repair-attempt row; the ark has none, so this is always null. */
  repairAttemptId: string | null
  repairedText: string | null
}

// Pure, directly unit-testable classifier. Binding-aware (§35): matching
// happens within the anchor-scoped window, not "anywhere in the whole
// document," so a correct value bound to the WRONG clause/entity is never
// mistaken for success — see the fixtures with anchorText: null above,
// where the ground truth string itself already encodes the full required
// binding instead.
export function classifyFactualRepair(fixture: FactualRepairFixtureExpected, repairedText: string | null): { status: FactualRepairStatus; presentGroundTruth: string[]; presentCorrupted: string[] } {
  if (repairedText == null || !repairedText.trim()) {
    return { status: 'not_repaired', presentGroundTruth: [], presentCorrupted: [] }
  }
  const window = findWindow(repairedText, fixture.anchorText)
  if (!window) return { status: 'not_repaired', presentGroundTruth: [], presentCorrupted: [] }

  const presentGroundTruth = fixture.expectedGroundTruth.filter(gt => containsExact(window, gt))
  const presentCorrupted = fixture.corruptedValues.filter(cv => containsExact(window, cv))

  if (presentGroundTruth.length === fixture.expectedGroundTruth.length && presentCorrupted.length === 0) {
    if (detectNewNumericCorruption(fixture, window)) return { status: 'new_corruption', presentGroundTruth, presentCorrupted }
    return { status: 'fully_repaired', presentGroundTruth, presentCorrupted }
  }
  if (presentGroundTruth.length === 0) {
    return { status: 'not_repaired', presentGroundTruth, presentCorrupted }
  }
  return { status: 'partially_repaired', presentGroundTruth, presentCorrupted }
}

// ── Aggregation / reporting ───────────────────────────────────────────────

export interface A2H12Measurements {
  eligible: boolean
  fixtureCount: number
  repairedCount: number
  failedRepairCount: number
  partialRepairCount: number
  newCorruptionCount: number
  repairRate: number | null
  byCategory: Record<string, { n: number; repairedCount: number }>
  fixtures: FactualRepairFixtureResult[]
}

// Primary numerator is fully_repaired ONLY (§35) — partial credit is never
// folded into the headline repairRate.
export function aggregateA2H12(results: FactualRepairFixtureResult[]): A2H12Measurements {
  if (results.length === 0) {
    return { eligible: false, fixtureCount: 0, repairedCount: 0, failedRepairCount: 0, partialRepairCount: 0, newCorruptionCount: 0, repairRate: null, byCategory: {}, fixtures: [] }
  }
  const repairedCount = results.filter(r => r.status === 'fully_repaired').length
  const byCategoryGroups = groupBy(results, r => r.category)
  const byCategory: Record<string, { n: number; repairedCount: number }> = {}
  for (const [category, group] of byCategoryGroups) {
    byCategory[category] = { n: group.length, repairedCount: group.filter(r => r.status === 'fully_repaired').length }
  }
  return {
    eligible: true,
    fixtureCount: results.length,
    repairedCount,
    failedRepairCount: results.filter(r => r.status === 'not_repaired').length,
    partialRepairCount: results.filter(r => r.status === 'partially_repaired').length,
    newCorruptionCount: results.filter(r => r.status === 'new_corruption').length,
    repairRate: results.length > 0 ? repairedCount / results.length : null,
    byCategory,
    fixtures: results,
  }
}

export interface A2H12Aggregate {
  n: number
  repairRate: ProportionSummary
  partialRepairCount: number
  newCorruptionCount: number
}

export function toAggregate(results: FactualRepairFixtureResult[]): A2H12Aggregate {
  const repairedCount = results.filter(r => r.status === 'fully_repaired').length
  return {
    n: results.length,
    repairRate: summarizeProportion(repairedCount, results.length),
    partialRepairCount: results.filter(r => r.status === 'partially_repaired').length,
    newCorruptionCount: results.filter(r => r.status === 'new_corruption').length,
  }
}

// ── Plan / measure ────────────────────────────────────────────────────────
// Humanite's runRepairEvaluationJob called
// `repairChunk(client, model, expected.cleanText, expected.corruptedText, REPAIR_TONE, source.domainId)`:
// cleanText is the ground truth the fact ledger is built from, corruptedText is the "output" it
// verifies and repairs. repairChunk no-ops (returns the text unchanged) when the ledger already passes.

export const A2H12_OPERATION = 'repair_facts' as const
export const REPAIR_TONE = 'balanced'

export function planA2H12(fixture: FactualRepairFixtureExpected, domain: string): TargetCall[] {
  return [{
    operation: A2H12_OPERATION,
    text: fixture.corruptedText,
    extra: { sourceText: fixture.cleanText, tone: REPAIR_TONE, domain },
  }]
}

/** repairChunk returned `text` (the repaired text, or the input unchanged when no repair applied). */
export function measureA2H12(fixtureId: string, fixture: FactualRepairFixtureExpected, result: TargetCallResult | null): FactualRepairFixtureResult {
  const repairedText = result ? result.output : null
  const { status, presentGroundTruth, presentCorrupted } = classifyFactualRepair(fixture, repairedText)
  return { fixtureId, category: fixture.category, status, presentGroundTruth, presentCorrupted, repairAttemptId: null, repairedText }
}

/** The score Humanite persisted for a fixture result (`passed` is always null). */
export function scoreA2H12(result: FactualRepairFixtureResult): number {
  return result.status === 'fully_repaired' ? 1 : 0
}

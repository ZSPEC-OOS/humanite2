import type { Firestore } from 'firebase-admin/firestore'
import type OpenAI from 'openai'
import type { Domain } from '@/lib/style/types'
import type { BenchmarkFixture, DeterministicTestContext, DeterministicEvaluation } from './types'
import { verifyClaims } from '@/lib/claims'
import { groupBy } from './statistics'
import { listTestResultsForRun } from './testResults'
import { listOutputsForRun } from './outputs'

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

export function evaluateClaimRelationshipPreservation(ctx: DeterministicTestContext): DeterministicEvaluation {
  const measurements = computeA2H16Measurements(ctx.fixtures, ctx.output.outputText)
  return {
    passed: measurements.eligible ? measurements.corruptedCount === 0 : null,
    score: measurements.preservationRate,
    measurements: measurements as unknown as Record<string, unknown>,
  }
}

// ── Reporting (mirrors a2h04.ts's Row/Filters/Report pattern) ────────────

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

export interface A2H16Row {
  sourceId: string
  outputId: string
  domainId: Domain
  topicId: string
  targetWords: number
  intensity: number
  measurements: A2H16Measurements
}

export async function getA2H16Rows(firestore: Firestore, runId: string): Promise<A2H16Row[]> {
  const [testResults, outputs] = await Promise.all([
    listTestResultsForRun(firestore, runId, A2H16_CODE),
    listOutputsForRun(firestore, runId),
  ])
  const outputsById = new Map(outputs.map(o => [o.id, o]))
  const rows: A2H16Row[] = []
  for (const tr of testResults) {
    if (!tr.outputId) continue
    const output = outputsById.get(tr.outputId)
    if (!output) continue
    rows.push({
      sourceId: tr.sourceId,
      outputId: tr.outputId,
      domainId: output.domainId,
      topicId: output.topicId,
      targetWords: output.targetWords,
      intensity: output.intensity,
      measurements: tr.measurements as unknown as A2H16Measurements,
    })
  }
  return rows
}

export interface A2H16Report {
  overall: A2H16Aggregate
  byCategory: Record<string, { n: number; preservedCount: number; corruptedCount: number; uncertainCount: number }>
  rows: A2H16Row[]
}

export async function getA2H16Report(firestore: Firestore, runId: string): Promise<A2H16Report> {
  const rows = await getA2H16Rows(firestore, runId)
  const allResults = rows.flatMap(r => r.measurements.results)
  const byCategoryGroups = groupBy(allResults, r => r.category)
  const byCategory: A2H16Report['byCategory'] = {}
  for (const [category, results] of byCategoryGroups) {
    byCategory[category] = {
      n: results.length,
      preservedCount: results.filter(r => r.status === 'preserved').length,
      corruptedCount: results.filter(r => r.status === 'corrupted').length,
      uncertainCount: results.filter(r => r.status === 'uncertain').length,
    }
  }
  return {
    overall: aggregateA2H16(rows.map(r => r.measurements)),
    byCategory,
    rows,
  }
}

// ── Verifier calibration (§26-27) ─────────────────────────────────────────
//
// A completely separate subtest from preservation above: this measures the
// MODEL-BASED verifyClaims() function's own reliability against a fixed,
// hand-authored dataset, independent of any corpus project or run. Ported
// from tests/benchmark/fixtures/claimFixtures.ts and
// tests/benchmark/tests/claimVerificationAcceptance.test.ts's correct-rewrite
// set (never imported directly — re-authored here as production data, per
// the standing "never import a tests/ file into runtime" rule) and expanded
// with 'condition'/'exception' cases neither source file covered.
export interface ClaimVerifierCalibrationCase {
  id: string
  category: ClaimRelationshipCategory
  source: string
  rewrite: string
  // true for a known-BAD rewrite (verifyClaims should fail it); false for a
  // known-CORRECT rewrite (verifyClaims should pass it, and failing it is a
  // false failure).
  expectedToFail: boolean
}

export const CLAIM_VERIFIER_CALIBRATION_SET: ClaimVerifierCalibrationCase[] = [
  // Known corruptions (expectedToFail: true) — ported from claimFixtures.ts,
  // plus two new condition/exception cases.
  { id: 'causal-direction-reversed', category: 'causal', source: 'Because sales grew sharply, the company increased hiring across every region.', rewrite: 'Because the company increased hiring across every region, sales grew sharply.', expectedToFail: true },
  { id: 'comparative-age-group-reversed', category: 'comparative', source: "The vaccine's efficacy was higher in younger adults than in older adults.", rewrite: "The vaccine's efficacy was higher in older adults than in younger adults.", expectedToFail: true },
  { id: 'comparative-timing-reversed', category: 'comparative', source: 'Taking the medication before meals improves absorption compared to taking it after meals.', rewrite: 'Taking the medication after meals improves absorption compared to taking it before meals.', expectedToFail: true },
  { id: 'attribution-regulator-swapped', category: 'attribution', source: 'According to federal regulators, the drug carries a black-box warning for cardiac risk.', rewrite: 'According to the manufacturer, the drug carries a black-box warning for cardiac risk.', expectedToFail: true },
  { id: 'attribution-author-vs-reviewers', category: 'attribution', source: 'The lead author reported that the effect size was smaller than expected.', rewrite: 'The peer reviewers reported that the effect size was smaller than expected.', expectedToFail: true },
  { id: 'attribution-executive-vs-analysts', category: 'attribution', source: 'Sales grew, the chief executive said, due to strong holiday demand.', rewrite: 'Sales grew, outside analysts said, due to strong holiday demand.', expectedToFail: true },
  { id: 'qualifier-family-history-dropped', category: 'qualifier', source: 'The treatment is effective in most patients with a family history of the condition.', rewrite: 'The treatment is effective in most patients.', expectedToFail: true },
  { id: 'qualifier-first-week-dropped', category: 'qualifier', source: 'Side effects are common only during the first week of treatment.', rewrite: 'Side effects are common during treatment.', expectedToFail: true },
  { id: 'condition-polarity-flipped', category: 'condition', source: 'The warranty applies if the product is used indoors.', rewrite: 'The warranty applies unless the product is used indoors.', expectedToFail: true },
  { id: 'exception-eligibility-flipped', category: 'exception', source: 'All employees must attend the meeting except those on approved leave.', rewrite: 'All employees must attend the meeting except those on unapproved leave.', expectedToFail: true },
  { id: 'exception-introductory-period-dropped', category: 'exception', source: 'The policy applies to new customers who sign up during the introductory period.', rewrite: 'The policy applies to new customers.', expectedToFail: true },

  // Known-correct rewrites (expectedToFail: false) — ported from
  // claimVerificationAcceptance.test.ts's CORRECT_REWRITE_PAIRS.
  { id: 'causal-reword', category: 'causal', source: 'Because sales grew sharply, the company increased hiring across every region.', rewrite: 'The company increased hiring across every region as sales grew sharply.', expectedToFail: false },
  { id: 'comparative-reword', category: 'comparative', source: "The vaccine's efficacy was higher in younger adults than in older adults.", rewrite: 'Among younger adults, the vaccine showed higher efficacy than it did among older adults.', expectedToFail: false },
  { id: 'timing-reword', category: 'comparative', source: 'Taking the medication before meals improves absorption compared to taking it after meals.', rewrite: 'Absorption improves more when the medication is taken before meals rather than after them.', expectedToFail: false },
  { id: 'attribution-reword-1', category: 'attribution', source: 'According to federal regulators, the drug carries a black-box warning for cardiac risk.', rewrite: 'Federal regulators have stated that the drug carries a black-box warning for cardiac risk.', expectedToFail: false },
  { id: 'attribution-reword-2', category: 'attribution', source: 'The lead author reported that the effect size was smaller than expected.', rewrite: 'The effect size, the lead author reported, came in smaller than expected.', expectedToFail: false },
  { id: 'attribution-reword-3', category: 'attribution', source: 'Sales grew, the chief executive said, due to strong holiday demand.', rewrite: 'The chief executive attributed the sales growth to strong holiday demand.', expectedToFail: false },
  { id: 'qualifier-reword-1', category: 'qualifier', source: 'The treatment is effective in most patients with a family history of the condition.', rewrite: 'Among patients with a family history of the condition, the treatment is effective for most.', expectedToFail: false },
  { id: 'qualifier-reword-2', category: 'qualifier', source: 'Side effects are common only during the first week of treatment.', rewrite: "It is only in treatment's first week that side effects are commonly seen.", expectedToFail: false },
  { id: 'qualifier-reword-3', category: 'condition', source: 'The policy applies to new customers who sign up during the introductory period.', rewrite: 'New customers who sign up during the introductory period are covered by the policy.', expectedToFail: false },
  { id: 'condition-reword', category: 'condition', source: 'The warranty applies if the product is used indoors.', rewrite: 'Indoor use of the product is what the warranty applies to.', expectedToFail: false },
  { id: 'exception-reword', category: 'exception', source: 'All employees must attend the meeting except those on approved leave.', rewrite: 'Every employee is expected at the meeting, aside from those with approved leave.', expectedToFail: false },
  { id: 'mixed-reword-1', category: 'causal', source: 'Because the marketing campaign launched in June, website traffic tripled.', rewrite: 'Website traffic tripled after the marketing campaign launched in June.', expectedToFail: false },
  { id: 'mixed-reword-2', category: 'attribution', source: 'According to the safety board, the outage was caused by a software update.', rewrite: 'The safety board found that a software update caused the outage.', expectedToFail: false },
  { id: 'mixed-reword-3', category: 'condition', source: 'The discount applies only to members who joined before the promotion ended.', rewrite: 'Only members who joined before the promotion ended qualify for the discount.', expectedToFail: false },
  { id: 'mixed-reword-4', category: 'causal', source: 'Reducing sodium intake lowers blood pressure in most adults.', rewrite: 'In most adults, blood pressure falls when sodium intake is reduced.', expectedToFail: false },
  { id: 'mixed-reword-5', category: 'attribution', source: 'The professor, not the teaching assistant, wrote the exam questions.', rewrite: 'It was the professor who wrote the exam questions, not the teaching assistant.', expectedToFail: false },
  { id: 'mixed-reword-6', category: 'qualifier', source: 'The bridge closure affected commuters only during rush hour.', rewrite: 'Commuters were affected by the bridge closure, but only during rush hour.', expectedToFail: false },
  { id: 'mixed-reword-7', category: 'causal', source: 'Warmer ocean temperatures are driving the increase in coral bleaching.', rewrite: 'The increase in coral bleaching is being driven by warmer ocean temperatures.', expectedToFail: false },
  { id: 'mixed-reword-8', category: 'attribution', source: 'Investors, according to the analyst report, are growing cautious about the sector.', rewrite: 'The analyst report says investors are growing cautious about the sector.', expectedToFail: false },
  { id: 'mixed-reword-9', category: 'condition', source: 'The refund policy covers defective items returned within 30 days.', rewrite: 'Defective items returned within 30 days are covered under the refund policy.', expectedToFail: false },
  { id: 'mixed-reword-10', category: 'attribution', source: "The city council, not the mayor's office, approved the new zoning rules.", rewrite: "It was the city council, rather than the mayor's office, that approved the new zoning rules.", expectedToFail: false },
]

export interface ClaimVerifierCalibrationCaseResult {
  id: string
  category: ClaimRelationshipCategory
  expectedToFail: boolean
  verifierPassed: boolean
  reasons: string[]
}

export interface ClaimVerifierCalibrationResult {
  verifierModel: string
  verifierConfigVersion: string
  computedAt: string
  knownCorruptionDetectionRate: number | null
  falseFailureRate: number | null
  cases: ClaimVerifierCalibrationCaseResult[]
}

export const DEFAULT_CLAIM_VERIFIER_CONFIG_VERSION = 'CLAIM-VERIFIER-V001'

// Runs the LIVE, paid verifyClaims() call against every calibration case —
// never invoked implicitly; a caller (the API route) decides when this cost
// is worth paying. Pure aggregation (computeCalibrationResult below) is kept
// separate so unit tests can exercise the detection-rate/false-failure-rate
// math without any live model call (§52).
export async function runClaimVerifierCalibration(client: OpenAI, model: string, verifierConfigVersion: string): Promise<ClaimVerifierCalibrationResult> {
  const cases: ClaimVerifierCalibrationCaseResult[] = []
  for (const c of CLAIM_VERIFIER_CALIBRATION_SET) {
    const result = await verifyClaims(client, model, c.source, c.rewrite, [])
    cases.push({ id: c.id, category: c.category, expectedToFail: c.expectedToFail, verifierPassed: result.passed, reasons: result.failures.map(f => f.reason ?? 'claim not entailed') })
  }
  return computeCalibrationResult(cases, model, verifierConfigVersion)
}

export function computeCalibrationResult(cases: ClaimVerifierCalibrationCaseResult[], verifierModel: string, verifierConfigVersion: string): ClaimVerifierCalibrationResult {
  const knownCorruptions = cases.filter(c => c.expectedToFail)
  const knownCorrect = cases.filter(c => !c.expectedToFail)
  const detected = knownCorruptions.filter(c => !c.verifierPassed).length
  const falseFailures = knownCorrect.filter(c => !c.verifierPassed).length
  return {
    verifierModel,
    verifierConfigVersion,
    computedAt: new Date().toISOString(),
    knownCorruptionDetectionRate: knownCorruptions.length === 0 ? null : detected / knownCorruptions.length,
    falseFailureRate: knownCorrect.length === 0 ? null : falseFailures / knownCorrect.length,
    cases,
  }
}

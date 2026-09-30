import type { Firestore } from 'firebase-admin/firestore'
import { summarizeProportion, groupBy, type ProportionSummary } from './statistics'
import { detectGrammarFindings } from './grammarEngine'
import { listTestResultsForRun } from './testResults'

export const A2H06_CODE = 'A2H-06' as const

// A2H-06 — Grammar Repair (§5-11): unlike A2H-04/05/09/10/13, this test is
// FIXTURE-scoped, not output-scoped — there is no BenchmarkOutput involved
// at all. Each grammar_repair fixture is a controlled derivative (a known
// grammatical corruption of a clean ground-truth passage) fed through the
// targeted grammar-repair path (repairGrammar, evaluation/repair.ts); the
// result is scored deterministically against the fixture's own known-good
// answer, never by an LLM judge (§9).
export type GrammarErrorCategory =
  | 'subject_verb_agreement' | 'verb_tense' | 'article' | 'preposition' | 'pronoun_agreement'
  | 'number_agreement' | 'fragment' | 'run_on' | 'punctuation' | 'modifier_placement' | 'parallelism'

export interface GrammarRepairFixtureExpected {
  cleanText: string
  corruptedText: string
  category: GrammarErrorCategory
  incorrectText: string
  expectedCorrection: string
  anchorText: string | null
}

// §7's ten canonical examples — used both as regression fixtures in tests
// and as the seed set an admin can bulk-import via the fixture admin UI
// (§29). incorrectText/expectedCorrection are the MINIMAL differing span
// (just the erroneous word), not the whole sentence, so word-boundary
// matching against a real repair attempt's output is unambiguous.
export const INITIAL_GRAMMAR_FIXTURES: GrammarRepairFixtureExpected[] = [
  { cleanText: 'A pathogen enters the bloodstream.', corruptedText: 'A pathogen enter the bloodstream.', category: 'subject_verb_agreement', incorrectText: 'enter', expectedCorrection: 'enters', anchorText: 'the bloodstream' },
  { cleanText: 'Some bacteria produce toxins.', corruptedText: 'Some bacteria produces toxins.', category: 'subject_verb_agreement', incorrectText: 'produces', expectedCorrection: 'produce', anchorText: 'toxins' },
  { cleanText: 'Protozoan parasites often have complex life cycles.', corruptedText: 'Protozoan parasites often has complex life cycles.', category: 'subject_verb_agreement', incorrectText: 'has', expectedCorrection: 'have', anchorText: 'complex life cycles' },
  { cleanText: 'The immune system recognizes the pathogen.', corruptedText: 'The immune system recognize the pathogen.', category: 'subject_verb_agreement', incorrectText: 'recognize', expectedCorrection: 'recognizes', anchorText: 'the pathogen' },
  { cleanText: 'These mechanisms help prevent transmission.', corruptedText: 'These mechanisms helps prevent transmission.', category: 'subject_verb_agreement', incorrectText: 'helps', expectedCorrection: 'help', anchorText: 'prevent transmission' },
  { cleanText: 'They do not treat viral infections.', corruptedText: 'They does not treat viral infections.', category: 'subject_verb_agreement', incorrectText: 'does', expectedCorrection: 'do', anchorText: 'viral infections' },
  { cleanText: 'Overuse can promote resistance.', corruptedText: 'Overuse can promotes resistance.', category: 'subject_verb_agreement', incorrectText: 'promotes', expectedCorrection: 'promote', anchorText: 'resistance' },
  { cleanText: 'Vaccination reduces disease severity.', corruptedText: 'Vaccination reduce disease severity.', category: 'subject_verb_agreement', incorrectText: 'reduce', expectedCorrection: 'reduces', anchorText: 'disease severity' },
  { cleanText: 'Hygiene measures limit transmission.', corruptedText: 'Hygiene measures limits transmission.', category: 'subject_verb_agreement', incorrectText: 'limits', expectedCorrection: 'limit', anchorText: 'transmission' },
  { cleanText: 'Understanding these pathways is essential.', corruptedText: 'Understanding these pathways are essential.', category: 'subject_verb_agreement', incorrectText: 'are', expectedCorrection: 'is', anchorText: 'essential' },
]

export type GrammarRepairStatus = 'corrected' | 'not_corrected' | 'partially_corrected' | 'overcorrected' | 'new_error_introduced'

// §11: "target error corrected" and "new error introduced" are kept as
// separate facts, never compressed into one status value — `status` is a
// convenience bucket for aggregation, but targetErrorCorrected/
// newErrorIntroduced are always independently inspectable.
export interface GrammarRepairFixtureResult {
  fixtureId: string
  category: GrammarErrorCategory
  status: GrammarRepairStatus
  targetErrorCorrected: boolean
  newErrorIntroduced: boolean
  repairAttemptId: string | null
  repairedText: string | null
}

export function validateGrammarRepairFixtureExpected(expected: Record<string, unknown>): string[] {
  const errors: string[] = []
  const validCategories: GrammarErrorCategory[] = [
    'subject_verb_agreement', 'verb_tense', 'article', 'preposition', 'pronoun_agreement',
    'number_agreement', 'fragment', 'run_on', 'punctuation', 'modifier_placement', 'parallelism',
  ]
  const cleanText = expected['cleanText']
  const corruptedText = expected['corruptedText']
  const category = expected['category']
  const incorrectText = expected['incorrectText']
  const expectedCorrection = expected['expectedCorrection']
  if (typeof cleanText !== 'string' || !cleanText.trim()) errors.push('cleanText is required.')
  if (typeof corruptedText !== 'string' || !corruptedText.trim()) errors.push('corruptedText is required.')
  if (typeof category !== 'string' || !validCategories.includes(category as GrammarErrorCategory)) errors.push(`category must be one of ${validCategories.join(', ')}.`)
  if (typeof incorrectText !== 'string' || !incorrectText.trim()) errors.push('incorrectText is required.')
  if (typeof expectedCorrection !== 'string' || !expectedCorrection.trim()) errors.push('expectedCorrection is required.')
  if (typeof corruptedText === 'string' && typeof incorrectText === 'string' && incorrectText && !corruptedText.includes(incorrectText)) {
    errors.push('incorrectText must appear verbatim in corruptedText.')
  }
  if (typeof cleanText === 'string' && typeof expectedCorrection === 'string' && expectedCorrection && !cleanText.includes(expectedCorrection)) {
    errors.push('expectedCorrection must appear verbatim in cleanText.')
  }
  return errors
}

// Deterministic candidate proposal (§29): a small, safe set of subject-verb
// agreement swaps generated from a clean source sentence by finding a
// KNOWN_VERB_BASES-recognized present-tense verb (via the grammar engine's
// own detector run against a synthetically pluralized/singularized clone)
// is out of scope for this phase's proposer — instead this reuses the
// engine's own SVA rule set in reverse is avoided entirely to prevent
// "correct" ambiguity (§29: "avoid transformations that could create
// ambiguous correct answers"). Candidate generation here is intentionally
// limited to the curated INITIAL_GRAMMAR_FIXTURES seed set; an admin
// reviews and approves each one explicitly before it becomes a real
// fixture, and nothing is auto-locked.
export function proposeGrammarRepairCandidates(): GrammarRepairFixtureExpected[] {
  return INITIAL_GRAMMAR_FIXTURES.map(f => ({ ...f }))
}

// A boundary-safe "does this exact phrase appear" check (case-insensitive)
// — a regex `\b` fails at a phrase edge that is itself punctuation (e.g.
// "happening?" at the end of a sentence has no adjacent word character for
// `\b` to anchor to, the same pitfall A2H-05's percentage regex hit in
// Phase 2), so this checks the adjacent characters directly instead.
function wordBoundaryIncludes(haystack: string, needle: string): boolean {
  if (!needle) return false
  const h = haystack.toLowerCase()
  const n = needle.toLowerCase()
  let from = 0
  while (true) {
    const idx = h.indexOf(n, from)
    if (idx === -1) return false
    const before = idx > 0 ? h[idx - 1]! : ''
    const after = idx + n.length < h.length ? h[idx + n.length]! : ''
    const boundaryOk = (c: string) => !c || !/[a-z0-9]/.test(c)
    if (boundaryOk(before) && boundaryOk(after)) return true
    from = idx + 1
  }
}

// A repair is a "minimal edit" if it doesn't change the sentence's overall
// length materially beyond the target correction — a deliberately coarse,
// deterministic proxy for "didn't rewrite more than necessary" (used only
// to distinguish 'corrected' from 'overcorrected').
function isMinimalEdit(cleanText: string, repairedText: string): boolean {
  const cleanWords = cleanText.trim().split(/\s+/).filter(Boolean).length
  const repairedWords = repairedText.trim().split(/\s+/).filter(Boolean).length
  return Math.abs(cleanWords - repairedWords) <= 2
}

// Pure, directly unit-testable classifier: given a fixture and the
// repaired text a model actually produced, decide deterministically what
// happened. Reuses the SAME grammar engine A2H-08 uses (never an LLM
// judge) to detect a new error the repair may have introduced elsewhere in
// the sentence (§11's "fixes the target but breaks something else" case).
export function classifyGrammarRepair(fixture: GrammarRepairFixtureExpected, repairedText: string | null): { status: GrammarRepairStatus; targetErrorCorrected: boolean; newErrorIntroduced: boolean } {
  if (repairedText == null || !repairedText.trim()) {
    return { status: 'not_corrected', targetErrorCorrected: false, newErrorIntroduced: false }
  }
  const repaired = repairedText.trim()
  const clean = fixture.cleanText.trim()

  const hasExpectedCorrection = wordBoundaryIncludes(repaired, fixture.expectedCorrection)
  // For a category like 'fragment', the "incorrect" span (the fragment
  // itself) is naturally a SUBSTRING of its own fix (the complete sentence)
  // — finding it inside the repaired text isn't evidence the defect
  // survived when the fix's own text is what's present. Only treat the
  // defect as "still there" when it isn't simply a byproduct of the
  // correction appearing.
  const incorrectSubsumedByCorrection = wordBoundaryIncludes(fixture.expectedCorrection, fixture.incorrectText)
  const stillHasTargetDefect = !incorrectSubsumedByCorrection && wordBoundaryIncludes(repaired, fixture.incorrectText)

  const cleanFindings = detectGrammarFindings(clean)
  const repairedFindings = detectGrammarFindings(repaired)
  const newErrorIntroduced = repairedFindings.some(f => !cleanFindings.some(cf => cf.category === f.category && cf.text.toLowerCase() === f.text.toLowerCase()))

  if (stillHasTargetDefect) {
    return { status: 'not_corrected', targetErrorCorrected: false, newErrorIntroduced }
  }
  if (!hasExpectedCorrection) {
    return { status: 'partially_corrected', targetErrorCorrected: false, newErrorIntroduced }
  }
  if (newErrorIntroduced) {
    return { status: 'new_error_introduced', targetErrorCorrected: true, newErrorIntroduced: true }
  }
  if (repaired === clean || isMinimalEdit(clean, repaired)) {
    return { status: 'corrected', targetErrorCorrected: true, newErrorIntroduced: false }
  }
  return { status: 'overcorrected', targetErrorCorrected: true, newErrorIntroduced: false }
}

// ── Aggregation / reporting ───────────────────────────────────────────────

export interface A2H06Measurements {
  eligible: boolean
  fixtureCount: number
  insertedErrorCount: number
  correctedCount: number
  remainingErrorCount: number
  partialCorrectionCount: number
  overcorrectionCount: number
  newErrorCount: number
  repairRate: number | null
  fixtures: GrammarRepairFixtureResult[]
}

export function aggregateA2H06(results: GrammarRepairFixtureResult[]): A2H06Measurements {
  if (results.length === 0) {
    return {
      eligible: false, fixtureCount: 0, insertedErrorCount: 0, correctedCount: 0, remainingErrorCount: 0,
      partialCorrectionCount: 0, overcorrectionCount: 0, newErrorCount: 0, repairRate: null, fixtures: [],
    }
  }
  const countOf = (status: GrammarRepairStatus) => results.filter(r => r.status === status).length
  const correctedCount = countOf('corrected')
  const insertedErrorCount = results.length
  return {
    eligible: true,
    fixtureCount: insertedErrorCount,
    insertedErrorCount,
    correctedCount,
    remainingErrorCount: countOf('not_corrected'),
    partialCorrectionCount: countOf('partially_corrected'),
    overcorrectionCount: countOf('overcorrected'),
    newErrorCount: results.filter(r => r.newErrorIntroduced).length,
    repairRate: insertedErrorCount > 0 ? correctedCount / insertedErrorCount : null,
    fixtures: results,
  }
}

export interface A2H06Aggregate {
  n: number
  repairRate: ProportionSummary
  remainingErrorCount: number
  partialCorrectionCount: number
  overcorrectionCount: number
  newErrorCount: number
}

function toAggregate(results: GrammarRepairFixtureResult[]): A2H06Aggregate {
  const correctedCount = results.filter(r => r.status === 'corrected').length
  return {
    n: results.length,
    repairRate: summarizeProportion(correctedCount, results.length),
    remainingErrorCount: results.filter(r => r.status === 'not_corrected').length,
    partialCorrectionCount: results.filter(r => r.status === 'partially_corrected').length,
    overcorrectionCount: results.filter(r => r.status === 'overcorrected').length,
    newErrorCount: results.filter(r => r.newErrorIntroduced).length,
  }
}

export interface A2H06Report {
  overall: A2H06Aggregate
  byCategory: Record<string, A2H06Aggregate>
  fixtures: GrammarRepairFixtureResult[]
}

// Reads already-persisted per-fixture BenchmarkTestResult rows (one per
// grammar_repair fixture — see execution.ts's runRepairEvaluationJob) and
// joins each against its own fixture record for category breakdowns.
// Never re-invokes the repair path.
export async function getA2H06Report(firestore: Firestore, runId: string): Promise<A2H06Report> {
  const testResults = await listTestResultsForRun(firestore, runId, A2H06_CODE)
  const results: GrammarRepairFixtureResult[] = []
  for (const tr of testResults) {
    if (!tr.fixtureId) continue
    results.push(tr.measurements as unknown as GrammarRepairFixtureResult)
  }

  const groups = groupBy(results, r => r.category)
  const byCategory: Record<string, A2H06Aggregate> = {}
  for (const [category, group] of groups) byCategory[category] = toAggregate(group)

  return { overall: toAggregate(results), byCategory, fixtures: results }
}
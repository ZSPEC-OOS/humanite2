// PORTED from humanite2 src/lib/a2h/deterministicEvaluators.ts @ 141e366, as a plain dispatch table of
// pure functions. Humanite's evaluators took a DeterministicTestContext (run, source, output record,
// fixtures); here each takes the source's fixtures and the output text, which is all they ever read.
// A2H-08 (grammar damage, in this table in Humanite) is owned by a2h08.ts and needs the source text too,
// so it is not part of this fixture-driven table.
import type { A2HTestCode, BenchmarkFixture, DeterministicEvaluation } from '../shared/types'
import { evaluateCitationPreservation } from './a2h04'
import { evaluateNumericUnitPreservation } from './a2h05'
import { evaluateModalityPreservation } from './a2h09'
import { evaluateProtectedTerms } from './a2h10'
import { evaluateTerminologyConsistency } from './a2h13'
import { evaluateClaimRelationshipPreservation } from './a2h16'

export type PureDeterministicEvaluator = (fixtures: BenchmarkFixture[], outputText: string) => DeterministicEvaluation

export const DETERMINISTIC_EVALUATORS: Partial<Record<A2HTestCode, PureDeterministicEvaluator>> = {
  'A2H-04': evaluateCitationPreservation,
  'A2H-05': evaluateNumericUnitPreservation,
  'A2H-09': evaluateModalityPreservation,
  'A2H-10': evaluateProtectedTerms,
  'A2H-13': evaluateTerminologyConsistency,
  'A2H-16': evaluateClaimRelationshipPreservation,
}

export function isDeterministicTest(code: A2HTestCode): boolean {
  return code in DETERMINISTIC_EVALUATORS
}

import type { A2HTestCode, DeterministicEvaluator } from './types'
import { evaluateCitationPreservation } from './a2h04'
import { evaluateNumericUnitPreservation } from './a2h05'
import { evaluateModalityPreservation } from './a2h09'
import { evaluateProtectedTerms } from './a2h10'
import { evaluateTerminologyConsistency } from './a2h13'

// The single dispatch table execution.ts uses for every fixture-backed test
// (§8) — adding A2H-06..17's future deterministic tests means adding one
// entry here and one new a2h0N.ts module, never a new conditional branch in
// execution.ts itself.
export const DETERMINISTIC_EVALUATORS: Partial<Record<A2HTestCode, DeterministicEvaluator>> = {
  'A2H-04': evaluateCitationPreservation,
  'A2H-05': evaluateNumericUnitPreservation,
  'A2H-09': evaluateModalityPreservation,
  'A2H-10': evaluateProtectedTerms,
  'A2H-13': evaluateTerminologyConsistency,
}

export function isDeterministicTest(code: A2HTestCode): boolean {
  return code in DETERMINISTIC_EVALUATORS
}

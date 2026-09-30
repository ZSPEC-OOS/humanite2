import type { A2HTestCode, DeterministicEvaluator } from './types'
import { evaluateCitationPreservation } from './a2h04'
import { evaluateNumericUnitPreservation } from './a2h05'
import { evaluateModalityPreservation } from './a2h09'
import { evaluateProtectedTerms } from './a2h10'
import { evaluateTerminologyConsistency } from './a2h13'
import { evaluateGrammarDamage } from './a2h08'

// The single dispatch table execution.ts uses for every OUTPUT-scoped
// deterministic test — adding a future deterministic test means adding one
// entry here and one new a2h0N.ts module, never a new conditional branch in
// execution.ts itself. A2H-06/A2H-12 (Phase 3) are NOT here: they are
// FIXTURE-scoped and paid (a targeted repair model call), so they run
// through the separate repair_evaluation job stage instead (see
// execution.ts's runRepairEvaluationJob).
export const DETERMINISTIC_EVALUATORS: Partial<Record<A2HTestCode, DeterministicEvaluator>> = {
  'A2H-04': evaluateCitationPreservation,
  'A2H-05': evaluateNumericUnitPreservation,
  'A2H-09': evaluateModalityPreservation,
  'A2H-10': evaluateProtectedTerms,
  'A2H-13': evaluateTerminologyConsistency,
  'A2H-08': evaluateGrammarDamage,
}

export function isDeterministicTest(code: A2HTestCode): boolean {
  return code in DETERMINISTIC_EVALUATORS
}

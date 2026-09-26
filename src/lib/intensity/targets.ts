import type { IntensityTarget } from './types'

// Authored design targets for each of the 10 intensity levels, increasing
// monotonically by construction. Not yet calibrated against real model
// output or human judgment (that calibration is Phase 11's job, once the
// benchmark scales up) — what this phase can establish now is that the
// prompt asks for, and the evaluator can measure, ten genuinely distinct
// targets rather than the three buckets the pipeline used before. Whether
// real model output actually clears Phase 4's acceptance bar (mean
// transformation magnitude strictly increasing I1->I10, fidelity pass
// rate >= 98% at every level) is checked empirically by
// tests/benchmark/tests/intensityAcceptance.test.ts, gated behind a live
// model run.
export const INTENSITY_TARGETS: Record<number, IntensityTarget> = {
  1: { level: 1, lexical: 0.05, syntactic: null, sentence: 0.03, paragraph: 0.00, discourse: 0.00 },
  2: { level: 2, lexical: 0.10, syntactic: null, sentence: 0.06, paragraph: 0.00, discourse: 0.00 },
  3: { level: 3, lexical: 0.16, syntactic: null, sentence: 0.10, paragraph: 0.03, discourse: 0.05 },
  4: { level: 4, lexical: 0.22, syntactic: null, sentence: 0.15, paragraph: 0.05, discourse: 0.10 },
  5: { level: 5, lexical: 0.30, syntactic: null, sentence: 0.22, paragraph: 0.08, discourse: 0.15 },
  6: { level: 6, lexical: 0.38, syntactic: null, sentence: 0.30, paragraph: 0.12, discourse: 0.22 },
  7: { level: 7, lexical: 0.46, syntactic: null, sentence: 0.38, paragraph: 0.16, discourse: 0.30 },
  8: { level: 8, lexical: 0.54, syntactic: null, sentence: 0.46, paragraph: 0.20, discourse: 0.38 },
  9: { level: 9, lexical: 0.62, syntactic: null, sentence: 0.54, paragraph: 0.25, discourse: 0.46 },
  10: { level: 10, lexical: 0.70, syntactic: null, sentence: 0.62, paragraph: 0.30, discourse: 0.55 },
}

export function intensityTarget(level: number): IntensityTarget {
  const clamped = Math.min(10, Math.max(1, Math.round(level)))
  return INTENSITY_TARGETS[clamped]!
}

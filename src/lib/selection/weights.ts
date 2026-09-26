import type { CandidateScores, RankingWeights } from './types'

// "Rank survivors by S = w_N·N + w_T·T + w_D·D + w_I·I + w_C·C, with
// weights fitted on the benchmark, not set by hand." Not yet calibrated
// against labeled preference data — starting values chosen to be neutral
// (equal weighting across the five dimensions) rather than an arbitrary
// hand-tuned guess, the same "conservative starting point, revisit once
// calibrated" convention qualityGates.ts's DEFAULT_THRESHOLDS and
// intensity/targets.ts's INTENSITY_TARGETS already use. fitWeights below is
// the actual fitting mechanism this line commits to — ready to run once
// Phase 11's benchmark scale-up (and its blind human pairwise ratings)
// produces labeled preference data to fit against. There is none yet, so
// this stays the honest placeholder rather than a fabricated "fitted" set
// of numbers no real data ever justified.
export const DEFAULT_WEIGHTS: RankingWeights = {
  naturalness: 0.2,
  tone: 0.2,
  domain: 0.2,
  intensity: 0.2,
  coherence: 0.2,
}

export function computeScore(scores: CandidateScores, weights: RankingWeights = DEFAULT_WEIGHTS): number {
  return (
    weights.naturalness * scores.naturalness +
    weights.tone * scores.tone_alignment +
    weights.domain * scores.domain_alignment +
    weights.intensity * scores.intensity_alignment +
    weights.coherence * scores.coherence
  )
}

export interface WeightFittingSample {
  scores: CandidateScores
  // A ground-truth quality/preference target this sample's weighted score
  // should approximate — e.g. a human pairwise-preference-derived value
  // from Phase 11's benchmark scale-up. Not defined by this module: fitting
  // is agnostic to where the label came from.
  target: number
}

const DIMENSIONS: (keyof CandidateScores)[] = ['naturalness', 'tone_alignment', 'domain_alignment', 'intensity_alignment', 'coherence']

// Gauss-Jordan elimination with partial pivoting, solving the small (5x5
// here) linear system Ax = b. A near-singular pivot column (fewer distinct
// samples than dimensions, or two dimensions that never vary independently
// in the sample set) is left as a zero contribution for that unknown
// rather than dividing by ~0 and returning a nonsense weight.
function solveLinearSystem(a: number[][], b: number[]): number[] {
  const n = b.length
  const m = a.map((row, i) => [...row, b[i]!])

  for (let col = 0; col < n; col++) {
    let pivotRow = col
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(m[r]![col]!) > Math.abs(m[pivotRow]![col]!)) pivotRow = r
    }
    ;[m[col], m[pivotRow]] = [m[pivotRow]!, m[col]!]

    const pivot = m[col]![col]!
    if (Math.abs(pivot) < 1e-9) continue

    for (let c = col; c <= n; c++) m[col]![c]! /= pivot
    for (let r = 0; r < n; r++) {
      if (r === col) continue
      const factor = m[r]![col]!
      for (let c = col; c <= n; c++) m[r]![c]! -= factor * m[col]![c]!
    }
  }

  return m.map(row => row[n]!)
}

// Ordinary least squares via the normal equations (X^T X) w = X^T y — fits
// the five weights that minimize squared error between the weighted
// combination above and each sample's labeled target. Deliberately
// unregularized and not constrained to sum to 1 or stay non-negative: with
// real labeled data this is a starting point to inspect, not a black box to
// trust blindly. Falls back to the neutral default with too few samples to
// fit five independent weights meaningfully, rather than overfitting noise.
export function fitWeights(samples: WeightFittingSample[]): RankingWeights {
  if (samples.length < DIMENSIONS.length) return DEFAULT_WEIGHTS

  const x = samples.map(s => DIMENSIONS.map(d => s.scores[d]))
  const y = samples.map(s => s.target)

  const xtx = DIMENSIONS.map((_, i) => DIMENSIONS.map((_, j) => x.reduce((sum, row) => sum + row[i]! * row[j]!, 0)))
  const xty = DIMENSIONS.map((_, i) => x.reduce((sum, row, idx) => sum + row[i]! * y[idx]!, 0))

  const w = solveLinearSystem(xtx, xty)
  return {
    naturalness: w[0]!,
    tone: w[1]!,
    domain: w[2]!,
    intensity: w[3]!,
    coherence: w[4]!,
  }
}

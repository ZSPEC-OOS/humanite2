import type { PairwiseRating } from './types'

export { sampleForPairwiseRating } from './sample'
export type { PairwiseComparisonItem, PairwiseRating } from './types'

// Below this many completed ratings, a win rate is noise rather than
// signal — the same "report null rather than fabricate precision from too
// little data" convention as reference/index.ts's
// MIN_REFERENCE_PASSAGES_PER_DOMAIN.
export const MIN_RATINGS_FOR_SIGNIFICANCE = 30

// NOT YET POPULATED — this is a known, intentional gap, not an oversight.
//
// The plan calls for "blind human pairwise ratings on a stratified
// sample" (Phase 11), used alongside the automated benchmark to validate
// that LLM-judge scores (naturalness, tone/domain alignment — see
// src/lib/evaluation/) actually track human judgment, the single largest
// risk the plan's own Risks section names ("LLM-judge scores do not track
// human judgment... Phase 6-8 optimize the wrong target").
//
// I (the model implementing this phase) cannot populate this myself, for
// the same reason tests/benchmark/reference/index.ts's human-written
// passages stay empty: a rating is only evidence of human judgment if a
// human actually made it. Anything I generated here — even framed as
// "simulating" a rater — would be indistinguishable in this array from a
// real one, and would silently invalidate the one thing Phase 11 uses this
// data for: checking whether the automated judge agrees with people.
//
// This needs real raters to populate, using sampleForPairwiseRating() to
// generate the stratified task list, each entry carrying a real `raterId`.
// Until then, hasSufficientRatings() correctly reports false and
// summarizePairwiseRatings() returns null, and the Phase 11 decision
// (see PHASE_11_DECISION.md) treats that as "not available" rather than
// substituting the LLM-judge's own scores as a stand-in for the human
// check they exist to validate.
export const HUMAN_RATINGS: PairwiseRating[] = []

export function hasSufficientRatings(): boolean {
  return HUMAN_RATINGS.length >= MIN_RATINGS_FOR_SIGNIFICANCE
}

export interface PairwiseRatingSummary {
  n: number
  baselineWinRate: number
  candidateWinRate: number
  tieRate: number
}

// Null — never a number computed from too little (or zero) data — until
// hasSufficientRatings() is true.
export function summarizePairwiseRatings(): PairwiseRatingSummary | null {
  if (!hasSufficientRatings()) return null
  const n = HUMAN_RATINGS.length
  const baselineWins = HUMAN_RATINGS.filter(r => r.preferred === 'baseline').length
  const candidateWins = HUMAN_RATINGS.filter(r => r.preferred === 'candidate').length
  const ties = HUMAN_RATINGS.filter(r => r.preferred === 'tie').length
  return {
    n,
    baselineWinRate: baselineWins / n,
    candidateWinRate: candidateWins / n,
    tieRate: ties / n,
  }
}

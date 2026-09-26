import type { Domain } from '../types'

// One (domain, tone, intensity) point selected for blind human review —
// see sample.ts for how the stratified set is built. This names WHICH
// corpus item and settings to generate a comparison from; it does not
// carry any generated text itself, since generating it requires a live
// model call this deterministic sampler has no business making (see
// sample.ts's own doc comment).
export interface PairwiseComparisonItem {
  id: string
  domain: Domain
  tone: string
  intensity: number
}

// A single blind pairwise judgment: a human rater sees two unlabeled
// passages generated from the same PairwiseComparisonItem — one from
// today's prompted pipeline ("baseline"), one from whatever alternative is
// being evaluated against it ("candidate", e.g. a future fine-tuned
// model per Phase 11's own decision gate) — with the assignment to
// "Passage A"/"Passage B" randomized per task to avoid position bias, and
// records which one they preferred.
export interface PairwiseRating {
  itemId: string
  domain: Domain
  tone: string
  intensity: number
  preferred: 'baseline' | 'candidate' | 'tie'
  // A named human rater, never 'placeholder' — see index.ts's own
  // "NOT YET POPULATED" rationale for why HUMAN_RATINGS starts empty.
  raterId: string
  ratedAt: string
}

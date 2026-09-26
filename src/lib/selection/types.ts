// Phase 8's candidate selection and planning. A RewritePlan is a small set
// of sentence/paragraph-level restructuring operations produced by ONE
// planning call (intensity >= 7 only) and shared by every candidate's
// generation prompt — "plan edits explicitly instead of forcing
// sentence-length templates": candidates vary in wording, not in which
// structural moves they attempt, since they all start from the same plan.
export interface RewritePlan {
  operations: string[]
}

// The five dimensions the plan's ranking formula combines
// (S = w_N·N + w_T·T + w_D·D + w_I·I + w_C·C) — naturalness and coherence
// from Phase 6's structured judge, tone/domain alignment from the same
// call, and intensity_alignment from Phase 4's measureIntensity. Never
// includes a fidelity dimension: a candidate that fails critical fidelity
// (entity_preservation, the deterministic fact ledger, or entailment) is
// disqualified before it reaches ranking at all, not scored down — see
// humanizePipeline.ts's selectBestCandidate.
export interface CandidateScores {
  naturalness: number
  tone_alignment: number
  domain_alignment: number
  intensity_alignment: number
  coherence: number
}

export interface RankingWeights {
  naturalness: number
  tone: number
  domain: number
  intensity: number
  coherence: number
}

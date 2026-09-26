// Phase 7's model-based claim verification. An atomic claim decomposes one
// assertion from the source into its load-bearing parts — who/what did what
// to whom, under what condition — so a rewrite can be checked claim-by-claim
// rather than as one holistic "does this still mean the same thing" verdict,
// which is exactly the granularity relation and attribution errors need
// (see verifier.ts).

export interface AtomicClaim {
  subject: string
  predicate: string
  object: string
  // Conditions, exceptions, populations, or time windows that narrow the
  // claim's scope (e.g. "only", "under age 40", "before March 1") — dropping
  // one of these is a qualifier-detachment error: the remaining sentence is
  // still true, but broader than the source ever claimed.
  qualifiers: string[]
  polarity: 'affirmative' | 'negative'
  modality: string | null
}

export interface ClaimVerdict {
  claim: AtomicClaim
  entailed: boolean
  // Empty when entailed — a short description of what changed otherwise
  // (e.g. "causal direction reversed", "attributed to a different speaker").
  reason: string | null
  // Index into splitSentences(output) where this claim's problem shows up,
  // or null when the model could not localize it to one sentence (e.g. the
  // claim is simply absent, not misstated in a specific place) — see
  // claims/repair.ts, which can only target a localized failure.
  outputSentenceIndex: number | null
}

export interface ClaimVerificationResult {
  passed: boolean
  claimCount: number
  failures: ClaimVerdict[]
}

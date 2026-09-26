# Phase 11 — Fine-tuning decision

Status: **NO-GO** (as of this writing). This is not a final answer — it is
the honest answer given what has actually been measured so far, with
explicit criteria for when to re-open the question.

## The plan's own decision rule

> Fine-tuning a rewriter is considered only if the prompted pipeline
> plateaus, and adopted only if it beats that pipeline on fidelity and
> style without breaching the budget.

Two things have to be true before "go" is even on the table:

1. **The prompted pipeline has plateaued** — demonstrated by a completed
   benchmark run across the full scale-up grid (300 items, 5 tones,
   intensities 2/5/8; see `runScaleUpSweep` in `runBenchmark.ts`) showing
   fidelity and style scores that stop improving across further prompt or
   architecture iteration.
2. **A fine-tuning candidate actually beats it** — on fidelity and style,
   within the Budget section's per-intensity call/latency ceilings — which
   requires a trained candidate to compare against in the first place.

Neither condition has been demonstrated. That alone settles the
"considered" gate; "adopted" was never reached.

## What has, and has not, been measured

**Built and verified (deterministic, no live model calls needed):**
- The full quality-gate and repair architecture from Phases 1–10: fact
  ledger, claim verification, style compiler with domain/genre/audience
  overlays, intensity targets, candidate selection, provider-capability
  gating, and document-level consistency checking.
- 648 passing unit/integration tests exercising that architecture, plus
  the deterministic adversarial fixtures (`fixtures/adversarial.ts`) that
  every fact-corruption category the plan names is checked against.
- The corpus itself: grown from 60 to 300 items (50 per domain) in this
  phase, satisfying the scale-up's data-volume requirement.
- The scale-up sweep runner (`runScaleUpSweep`) and the stratified
  human-rating sampler (`humanRatings/sample.ts`), both implemented and
  covered by always-on smoke tests using a stubbed client.

**Not measured, and not fabricated:**
- **No live run of the 300-item corpus, at any tone/intensity, has
  actually been executed against a real model.** This implementation
  environment has no live model credentials or network access to a
  provider; `liveBenchmark.test.ts` and `scaleUpSweepAcceptance.test.ts`
  are both written and ready, but both are gated behind
  `RUN_LIVE_BENCHMARK=true` and have not been run. There is therefore no
  actual fidelity/style trend line to check for a plateau against.
- **No human pairwise ratings exist.** `humanRatings/index.ts` documents
  why this cannot be filled in by an AI the same way
  `reference/index.ts`'s human-written passages cannot: a rating is only
  evidence of human judgment if a human made it. Without this, there is no
  check on whether the LLM-judge scores the pipeline already reports
  (naturalness, tone/domain alignment) track what a person would actually
  prefer — the single largest risk the plan's own Risks section names.
- **No fine-tuned candidate exists** to compare against the prompted
  pipeline on fidelity, style, or budget, because building one is only
  justified once the first two gaps above are closed and show a plateau.

## Why "no-go" rather than "not yet decided"

The plan's governing principle is "measure before optimizing" — a
decision to fine-tune without the plateau evidence and without human
validation of the judge signals would be exactly the kind of unearned
confidence that principle exists to rule out, even though the
architecture is now in place to make that measurement possible. The
honest call, given the current evidence, is a documented no-go rather
than an open question with no resolution criteria.

## What would change this decision

Re-run this analysis once, in order:

1. `RUN_LIVE_BENCHMARK=true` runs of `liveBenchmark.test.ts` and
   `scaleUpSweepAcceptance.test.ts` (or the full 300-item x 15-cell sweep
   via `runScaleUpSweep` directly) exist and are compared across at least
   2 successive prompt/architecture iterations with no material fidelity
   or style improvement between them — the operational definition of
   "plateaued" for this product.
2. `humanRatings/index.ts`'s `HUMAN_RATINGS` is populated past
   `MIN_RATINGS_FOR_SIGNIFICANCE` (30) by real raters using
   `sampleForPairwiseRating()`, and `summarizePairwiseRatings()` shows the
   automated judge's verdicts agree with human preference at a rate the
   team considers trustworthy enough to optimize against.
3. Only then does building a fine-tuning candidate become justified, and
   only a candidate that then beats the prompted pipeline on fidelity and
   style, within the existing per-intensity call/latency budget, gets
   adopted.

Marketing and UX claims are unaffected either way — the plan is explicit
that "1–10 intensity" and "medical-domain rewriting" claims stand on their
own Phase 4/3 acceptance criteria, not on this decision.

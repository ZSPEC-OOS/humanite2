# Benchmark fixes — Humanite Live Launch Benchmark run #2 follow-up

Run #2 (`.github/workflows/live-benchmark.yml`, commit `d35f9a346c1c1a7373909bdc7daa23fc3b022558`)
reported 3 passing suites and 5 failing/incomplete ones. This document
covers what failed, what changed in response, whether each was a defect in
the product or in the test harness measuring it, and what the next live run
should confirm.

## 1. Claim-verification false positive

**Failure.** `claimVerificationAcceptance.test.ts` flagged a rewrite as a
relation/attribution violation on a rewrite that only changed voice/cleft
structure or reporting-verb choice for the same entity — a false positive,
not a real fidelity defect.

**Classification: product.** The judge prompt (`src/lib/claims/verifier.ts`,
`buildPrompt`) didn't distinguish "the claim's substance changed" from
"the surface phrasing changed but the claim didn't."

**Change.** Rewrote the entailment-rule section of the prompt to explicitly
name non-violations (voice/cleft changes, reporting-verb variation for the
same entity, qualifier rephrasing that preserves scope) and added one
calibration example of each (a non-violation and a violation), so the judge
has a concrete anchor for the boundary instead of inferring it from a
general instruction.

**Verified locally.** `npx vitest run src/lib/claims/tests/verifier.test.ts`
(9/9 pass). Could not re-run the live acceptance test itself (no model
credentials in this environment) — **the next live run should confirm**
`claimVerificationAcceptance.test.ts` passes and, ideally, spot-check a few
of its judge outputs for the specific voice/cleft/reporting-verb cases that
previously false-positived.

## 2. Style acceptance — a "≥90%" threshold that was actually "≥100%"

**Failure.** `styleAcceptance.test.ts` failed on a single stochastic model
miss out of 8 sampled items.

**Classification: test harness.** `Math.ceil(8 * 0.9) = 8` — at n=8, a
"≥90% of items" requirement silently became "100% of items," so any one
miss failed the whole suite regardless of whether the style compiler was
actually working correctly.

**Change.** Increased `SAMPLE_SIZE` from 8 to 20 (`ceil(20 * 0.9) = 18`,
genuinely tolerating up to 2 misses) and extracted the threshold computation
into a named `passThreshold(n)` helper used by both tests in the file, so
the same bug can't recur silently in one test but not the other. Test
timeout raised 20min → 45min to fit the larger sample.

**Also changed (product):** `src/lib/style/toneProfiles.ts` — casual tone's
hedging rule now explicitly names the hedge words to avoid ("suggests",
"appears", "generally", etc.) while explicitly protecting genuine modal
verbs ("may", "might", "could", "should", "must") from removal, since those
overlap with the hedge-word list but are separately fact-locked by
`validateFactLedger`'s modality extractor — the old wording risked the
model treating "should" as a stylistic hedge to strip rather than a claim to
preserve. Academic tone's hedging rule had its "unless the source states it
as flat fact" carve-out removed, since that carve-out made the rule a no-op
for most source text (most source text states things as flat fact); it now
instructs epistemic framing regardless, while explicitly protecting
locked/fact-critical spans from being hedged.

Also changed: `src/lib/style/types.ts`, `compiler.ts`, `promptBuilder.ts` —
domain/genre/audience rules (overrides) are now tagged with their `source`
and rendered as a separate, explicitly-labeled "Required constraints" block
ahead of a "Tone guidance" block, rather than one flat bullet list. This is
aimed at the same class of problem from the other direction: making an
override like legal's "never use contractions" win more reliably against a
competing tone rule, structurally rather than only through wording strength.

**Verified locally.** Unit tests for the compiler/promptBuilder/toneProfiles
changes pass (`npx vitest run src/lib/style`). **The next live run should
confirm** `styleAcceptance.test.ts` passes at the new sample size, and that
its console output shows a real (not just-barely-above-threshold) pass rate
for all three axes (contraction rate, sentence length, hedge density).

## 3. Intensity acceptance — a genuine production bug plus a brittle test

**Failure.** `intensityAcceptance.test.ts`'s strict "every one of 9 adjacent
levels must show a strictly greater mean magnitude" failed on level 3
(0.12345) vs level 4 (0.122275) — a difference far smaller than run-to-run
sampling noise at N=4.

**Classification: both.**

- **Product bug, found while investigating:** `src/lib/intensity/promptGuide.ts`'s
  discourse-reordering instruction collapsed levels 3–6 onto byte-identical
  wording ("mostly follow the source; only reorder where clearly
  beneficial") — the one dimension of the intensity guide that wasn't
  already driven by its own per-level numeric target, unlike the
  lexical/sentence lines. Fixed to embed the actual target percentage at
  every level (`Sentence order ... may be reorganized for roughly ${pct}%
  ...`), giving every level a genuinely distinct instruction.
- **Test harness bug:** a strict per-adjacent-pair comparison at N=4 is
  measuring sampling noise, not the actual property Phase 4 cares about
  ("intensity reliably produces more transformation as it goes up").

**Change.** Per explicit approval to fix both the measurement design and the
production behavior together: replaced the strict monotonicity loop with
three checks that are harder to satisfy by accident but tolerate one noisy
adjacent pair: (1) Pearson correlation between level and mean magnitude
≥0.85, (2) at least 7 of 9 adjacent steps must increase, (3) banded mean
separation (low=1-3, mid=4-7, high=8-10) of at least 0.03 magnitude between
adjacent bands. Sample size raised 4→6. Fidelity pass-rate ≥98% check
unchanged. Timeout 60min→90min for the larger sample.

**Verified locally.** `npx vitest run src/lib/intensity` (20/20 pass,
including the level-10 discourse-wording substring test).
**The next live run should confirm** `intensityAcceptance.test.ts` passes
under the new criterion, and that the printed `meanMagnitudeByLevel` array
shows a materially larger level 3→6 spread than run #2's (where those levels
were nearly flat) — that's the direct signal the promptGuide fix worked,
independent of whether the statistical test happens to pass.

## 4. DeepSeek provider acceptance — timeout too short, not a pipeline failure

**Failure.** `providerCapabilitiesAcceptance.test.ts` reached the DeepSeek
sub-test and failed on a 60-second test timeout, not on the pipeline
assertion itself.

**Classification: test harness.** A single chunk through a third-party
OpenAI-compatible endpoint can legitimately take longer than 60s, especially
with capability-probe retries in play — the test was failing on its own
impatience.

**Change.** Raised the per-provider test timeout from 60s to 3 minutes
(`tests/benchmark/tests/providerCapabilitiesAcceptance.test.ts`). No change
to the pipeline assertion.

**Verified locally.** `npx tsc --noEmit` clean; test correctly skips without
`RUN_LIVE_BENCHMARK`/API keys. **The next live run should confirm** the
DeepSeek sub-test completes within 3 minutes and reports `gates_available`/
`degraded` honestly (see #5 below for why that logging used to be noisy).

## 5. Repeated "gate unavailable" log spam for providers without embeddings

**Not a failing test, but explicitly called out as needing investigation.**
`src/lib/qualityGates.ts`'s `runQualityGates` logged `Semantic similarity
gate unavailable, continuing without it` at `console.warn` on **every
single call** for a provider like DeepSeek that has no embeddings capability
at all (`resolveCapabilities` already correctly reports
`embeddings: false` for it, statically, per provider — that part was never
wrong). The mechanism (`unsupported()`) rejected a plain `Error` for a
known-and-static capability gap the exact same way it would for a genuine,
one-off transient failure of a call that was actually attempted — so a
300-item run against such a provider would produce hundreds of identical
warnings, drowning out real signal in the log.

**Classification: product** (logging/observability defect — the actual
`gates_available`/`degraded` bookkeeping downstream was already correct and
is unchanged).

**Change.** Added a `CapabilityUnsupportedError` subclass, thrown only by
`unsupported()`. `runQualityGates`'s logging now checks the rejection's
type: a `CapabilityUnsupportedError` (this provider was never going to
support this gate) is logged once per (gate, provider) pair for the life of
the process via a module-level de-dup set, using `console.info` since it's
an expected, static fact rather than a warning; a genuine failure of an
attempted call still logs at `console.warn` every time, unthrottled, since
that's actionable and not guaranteed to repeat identically.
`humanizePipeline.ts`'s own embeddings call (Stage 2 of candidate selection)
was already correctly gated behind `if (capabilities.embeddings)` and never
attempted at all for such a provider — no change needed there; only
`qualityGates.ts`'s always-attempt-then-catch pattern had the bug.

Did **not** add a separate optional embedding-provider fallback path (the
task described this as optional, "if compatible," and it would require
either a new secret or design decision beyond a targeted fix) — flagging
this as a candidate for separate, explicit follow-up if DeepSeek-class
providers' lack of embeddings coverage turns out to matter for launch.

**Verified locally.** `npx vitest run src/lib/tests/qualityGates.test.ts
src/lib/tests/humanizePipeline.test.ts` (108/108 pass); manually confirmed
via test output that the informational message for a given (gate, baseURL)
pair prints once, not once per call. **The next live run should confirm**
the DeepSeek/other-no-embedding-provider sub-runs no longer spam the log
with hundreds of identical lines, while still surfacing a genuine embedding
failure (if one occurs) every time it happens.

## 6. 300-item baseline — timeout and lack of resumability

**Failure.** The 300-item baseline job ran long enough (up to 9 model calls
per chunk × 300 items at real network latency) to risk hitting the
workflow's own job timeout before finishing, with no partial progress
preserved if it did.

**Classification: test harness / CI infrastructure.**

**Change.**
- `tests/benchmark/runBenchmark.ts`: `RunBenchmarkOptions` gained
  `checkpointPath` and `resumeFromCheckpoint`. When set, `runBenchmark`
  writes the partial results array to `checkpointPath` after every single
  item completes, and (when `resumeFromCheckpoint` is true) loads and skips
  any items already present in an existing checkpoint file rather than
  re-running and re-billing them. Both options are optional and default to
  off, so every existing caller is unaffected.
- `tests/benchmark/tests/liveBenchmark.test.ts`: now reads an optional
  `BENCHMARK_DOMAIN` env var. Set, it runs only that domain's 50-item slice
  (via the existing `corpusByDomain` helper) with its own smaller 40-minute
  timeout and writes `shard-<domain>.json`; unset, it runs the full 300-item
  corpus exactly as before (90-minute timeout, unchanged filename). Also
  wires a checkpoint path (`BENCHMARK_CHECKPOINT_PATH`, or a sensible
  per-domain default under `results/checkpoints/`) unconditionally, since
  this test only ever runs live and checkpointing costs nothing when unused.
- `tests/benchmark/aggregateShards.ts` (new): `combineShardReports`
  concatenates N shard reports' `results` arrays and recomputes the summary
  via the now-exported `buildReport` (the exact same formulas a single
  monolithic run would use — not a mean-of-means across shards, which would
  misweight unevenly-sized shards). `readShardReports` reads shard JSON
  files from a directory.
- `tests/benchmark/tests/aggregateShards.test.ts` (new): always-on unit
  tests for the combination math (concatenation, true-mean-not-mean-of-means,
  model/timestamp carry-through, detector-rate weighting, empty-input
  rejection) — no I/O, no live calls, runs in ordinary CI.
- `tests/benchmark/tests/aggregateShardsRunner.test.ts` (new): the actual
  file-I/O step (read shard files from `BENCHMARK_SHARD_DIR`, combine, write
  `combined.json`), gated behind that env var rather than
  `RUN_LIVE_BENCHMARK` since it makes no live calls at all.
- `package.json`: added `benchmark:aggregate` script.
- `.github/workflows/live-benchmark.yml`: `baseline` is now a 6-way matrix
  (one job per domain, 45-minute timeout each, `fail-fast: false`), each
  uploading its own uniquely-named artifact. A new `baseline-aggregate` job
  (`needs: baseline`, `if: always() && needs.baseline.result != 'skipped'`,
  so one failed/slow domain doesn't block combining the ones that
  succeeded) downloads every shard artifact and runs
  `pnpm benchmark:aggregate` to produce one combined 300-item report.

**Caveat, documented in code:** each shard calibrates its own detector's
fixed-false-positive-rate threshold against only its own domain's reference
passages, so the combined report's `detectorAiRateAtFixedFpr` is a weighted
average of per-shard rates rather than the single blended-across-domains
threshold a monolithic run would compute. This is identical in practice as
of today (every shard reports `null` for every detector, since
`tests/benchmark/reference/index.ts`'s `REFERENCE_PASSAGES` is still
unpopulated) but is worth re-checking once real reference data exists.

**Verified locally.** `npx tsc --noEmit` clean; `npx vitest run
tests/benchmark/tests/aggregateShards.test.ts
tests/benchmark/tests/aggregateShardsRunner.test.ts
tests/benchmark/tests/corpus.test.ts` (12/12 pass, 1 correctly skipped
without `BENCHMARK_SHARD_DIR`); manually exercised the aggregation runner
end-to-end against two hand-written fixture shard files on disk and
confirmed the combined report's numbers. Workflow YAML validated with
`python3 -c "import yaml; yaml.safe_load(...)"`.
**The next live run should confirm** all 6 domain shards complete within
their 45-minute budget, `baseline-aggregate` produces a `combined.json` with
`itemCount: 300`, and — if any single shard is killed or fails — a re-run of
just that shard (with the same checkpoint path) resumes rather than
restarting from item 1.

## 7. Candidate-selection telemetry (new visibility, not a failing test)

**Not a failing test**, but explicitly requested: the live run's logs
repeatedly showed `Candidate selection: every candidate was disqualified at
the entity_preservation stage`, with no way to tell from the report alone
whether this was rare or routine, or at which stage it concentrated.

**Change.** `src/lib/humanizePipeline.ts`:
- New `CandidateSelectionSummary` (`ranCandidateSearch`, `candidateCount`,
  `disqualifiedAt`) attached to every `ChunkResult`, threaded through
  `selectBestCandidate`/`fallbackToScoredCandidate`/
  `runSingleCandidateRetryLoop`/`humanizeChunk`.
- `aggregateChunkResults` now returns a `candidate_selection` summary:
  chunks that ran candidate search, chunks where every candidate was
  disqualified, a per-stage breakdown, the disqualification rate (`null`
  when candidate search never ran), and total candidates generated.
- `tests/benchmark/types.ts`/`runBenchmark.ts`/`report.ts`: threaded into
  `BenchmarkItemResult.candidateSelection` and
  `BenchmarkReport.summary.candidateDisqualificationRate` /
  `candidateDisqualifiedByStage`, and into the printed summary.
- `tests/benchmark/tests/candidateSelectionAcceptance.test.ts`: now logs
  how many of its sampled chunks hit the all-disqualified fallback.

**Explicitly not done:** did not loosen `entity_preservation` or any other
gate threshold. Per the task's own instruction, a high disqualification rate
is a signal to strengthen prompt construction, not to weaken the gate
catching real violations — this fix only adds the visibility needed to make
that call with evidence; it does not itself change generation or gating
behavior.

**Verified locally.** New unit tests for both the per-chunk telemetry
(`humanizeChunk` — Phase 8 tests) and the aggregate summary
(`aggregateChunkResults` — candidate selection telemetry) pass; full suite
698/698 non-skipped tests pass. **The next live run should confirm** the
report's `candidateDisqualificationRate` and `candidateDisqualifiedByStage`
are populated and give a concrete number to investigate — e.g., "12% of
chunks disqualified every candidate, all at entity_preservation, all in the
legal domain" would point at a specific, targeted follow-up rather than a
vague impression from scattered log lines.

## Verification performed this pass

- `pnpm tsc --noEmit` (via `npx tsc --noEmit`) — clean.
- Full unit suite (`npx vitest run`, `RUN_LIVE_BENCHMARK` unset) — 698
  passed, 18 correctly skipped (all `RUN_LIVE_BENCHMARK`/env-gated live
  suites), 0 failed.
- `npx next lint` — no errors (2 pre-existing `<img>` warnings unrelated to
  this work).
- `npx next build` — succeeds.
- Did **not** run any live DeepSeek/OpenAI/detector call — this environment
  has no model provider credentials. Every claim above about live behavior
  is inferred from reading the exact code path involved plus the reported
  symptom values, not from re-observing the live failure directly; the
  "next live run should confirm" notes throughout this document are the
  intended empirical check.

## Regression check on previously-passing areas

No changes were made to `candidateSelectionAcceptance.test.ts`'s pass/fail
criteria (only added a log line), `documentAcceptance.test.ts`,
`repairAcceptance.test.ts`, the deterministic fact-ledger tests, or any
other previously-green suite's assertions. `ChunkResult` and
`AggregatedQuality` both gained new required fields
(`candidateSelection` / `candidate_selection`) — every call site and test
fixture constructing these types directly was updated to match; the full
unit suite passing confirms nothing else broke.

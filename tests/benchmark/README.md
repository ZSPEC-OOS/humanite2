# Benchmark v0 (Phase 2), scaled up in Phase 11

The minimum measurement needed to evaluate Phases 3–8 of the Humanite
Improvement Plan. See the plan's Phase 2 section for the full spec this
implements. Phase 11 grows the corpus and adds a tone/intensity sweep and
human-rating infrastructure — see `PHASE_11_DECISION.md` for the
resulting go/no-go call on fine-tuning.

## Layout

- `types.ts` — shared types: `CorpusItem`, `AdversarialFixture`,
  `BenchmarkReport`.
- `corpus/` — 300 source documents (50 per domain × 6 domains: general,
  academic, business, technical, medical, legal — matching the product's
  own domain list in `ControlPanel.tsx`; grown from 60 in the Phase 11
  scale-up, see `corpus/helpers.ts`), each with `mandatoryFacts`
  (exact substrings that must survive a correct rewrite) and
  `prohibitedChanges` (exact substrings a correct rewrite must never
  introduce).
- `reference/` — the human-written reference set the plan calls for.
  **Not yet populated** — see the doc comment in `reference/index.ts` for
  why: an AI (this implementation included) authoring "human-written"
  reference text would silently invalidate both of its uses (Phase 3 style
  targets, and this harness's own detector calibration). This needs a human
  curator to populate with real, attributed passages.
- `fixtures/adversarial.ts` — 11 deterministic corruption pairs (no model
  calls) covering all 10 categories the plan names: unit-quantity,
  modality, negation, comparator, sign, range-endpoint,
  scientific-notation, version-number, cross-reference, entity-swap.
- `runBenchmark.ts` — runs the real pipeline (`preprocess` →
  `chunkFactLockedText` → `humanizeChunk`) against the corpus, plus both
  configured detectors, and produces a `BenchmarkReport`.
- `report.ts` — persists a report to `results/` and formats a human-readable
  summary.
- `tests/adversarialFixtures.test.ts` — runs each fixture through the real,
  current validator (`preprocess.ts` + `checkEntityOverlap`). A fixture the
  validator misses is committed as `it.fails`: the inner assertion genuinely
  fails today (tracked, not swept under the rug), and `it.fails` keeps the
  suite green until Phase 5's deterministic fact ledger closes the gap — at
  which point that specific test starts failing (an assertion that
  unexpectedly passed), the signal to promote it to a plain `it(...)`.
- `tests/corpus.test.ts` — structural integrity checks on the corpus data
  itself (every `mandatoryFact` really is a substring of its own item,
  every `prohibitedChange` really is absent from it, etc.).
- `tests/runBenchmark.test.ts` — an always-on smoke test proving the
  harness runs end-to-end, using a stubbed OpenAI client and two
  independently-identified stub detectors. Spends no real API credits and
  needs no credentials — this is what satisfies "harness runs end-to-end"
  in ordinary CI.
- `tests/liveBenchmark.test.ts` — the real run, against the full 300-item
  corpus and whichever detectors are configured. Gated behind
  `RUN_LIVE_BENCHMARK=true` (skipped otherwise) since it spends real money.
- `tests/scaleUpSweep.test.ts` — always-on smoke test proving the sweep's
  grid construction (one `runBenchmark` pass per tone x intensity cell)
  with a stubbed client, the same pattern as `runBenchmark.test.ts`.
- `tests/scaleUpSweepAcceptance.test.ts` — the real Phase 11 scale-up sweep
  across 5 tones at intensities 2, 5 and 8 (see `runScaleUpSweep` in
  `runBenchmark.ts`), against a small cross-domain sample. Also gated
  behind `RUN_LIVE_BENCHMARK=true`.
- `humanRatings/` — stratified-sampling and pairwise-comparison
  infrastructure for the blind human ratings Phase 11 calls for. **Not yet
  populated with real ratings** — see the doc comment in
  `humanRatings/index.ts` for why, the same reason `reference/index.ts`
  below stays empty.

## Running a real report

```
RUN_LIVE_BENCHMARK=true OPENAI_API_KEY=sk-... pnpm benchmark
```

or `make benchmark` with the same environment variables set. Optionally set
`GPTZERO_API_KEY` and/or `SAPLING_API_KEY` — a detector without a configured
key reports an error for that item rather than aborting the whole run.

The report is written to `tests/benchmark/results/<timestamp>.json` and a
human-readable summary is printed to the console.

## What's tracked

Per the plan: fact preservation (`entityPreservation`), semantic fidelity
(`semanticSimilarity`), retry rate, latency, tokens, cost (a rough estimate
— see `DEFAULT_MODEL_PRICING_PER_1K_TOKENS` in `runBenchmark.ts`, not tied
to actual billing), and detector rate at a fixed false-positive rate across
both configured detectors (GPTZero and Sapling by default). The
fixed-false-positive-rate figure is `null` for any detector until the human
reference set is populated — reporting a number derived from zero or
placeholder human passages would be exactly the kind of fabricated
precision the plan's governing principles rule out.

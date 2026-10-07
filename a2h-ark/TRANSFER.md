# The Great A2H Transfer: runbook

**Status: prepared, not executed.** Nothing in this runbook has been run against Humanite's real data, a real model or a real detector. No step below that moves, deletes or merges anything is to be carried out without the owner's explicit go-ahead.

## What exists

| Piece | Where | State |
| --- | --- | --- |
| Pack loader | BenchMarkr branch `claude/pack-loader` (`BENCHMARKR_PACKS`) | Built, server tests pass. Not merged. |
| Scoring for the 17 tests (pure) | `a2h-ark/src/scoring`, `src/vendor`, `src/shared` | Ported with tests (ark suite: 466 tests passing, `tsc` clean). |
| Pack (adapter, benchmark package, detector role) | `a2h-ark/src/pack` → `dist/pack.mjs` | Built; loads in BenchMarkr's real `loadPacks` and registries. Not run through the persistence-backed runner. |
| Corpus generator spec | `a2h-ark/src/generator-specs/corpus.json` | Validates in BenchMarkr's parser. Never generated with a live model. |
| Export tool (corpus, fixtures → JSONL) | `a2h-ark/tools/export` | Tested on fake data only. |
| Benchmark service endpoint | Humanite `src/app/api/v1/benchmark`, `src/lib/benchmark-service` | Unit tested with the product mocked. No live model call, no real HTTP request. **Survives the erase.** |

## Phase 0: before anything moves (owner decisions)

1. Where the ark lands in BenchMarkr: a `packs/a2h/` directory in that repository, or its own repository. The pack only needs `@benchmarkr/core` and `@benchmarkr/contracts` to resolve at runtime (see "Build and load").
2. Whether the `a2h_admin` sign-in claim stays (see `ERASE-LIST.md`, "Shared code that mentions A2H").
3. Whether the detector service role stays `required` (a fixture-only run currently still needs a detector bound).
4. Which model name and Humanite version the repeatability test (A2H-07) should record in its condition ids; today it uses source and intensity only.

## Phase 1: land the framework (BenchMarkr)

1. Merge `claude/pack-loader` into BenchMarkr main (owner action).
2. Confirm on main: `npm run build`, server tests, lint.

## Phase 2: stand up Humanite's endpoint

1. Set `HUMANITE_BENCHMARK_TOKEN` (32 characters or more, random) in Humanite's environment. Unset or short means the endpoint answers 404.
2. Deploy, then `GET /api/v1/benchmark/health` with the token: expect `{ok:true,…}`.
3. Make one real `humanize`, one `repair_grammar`, one `repair_facts` call and read the results by eye. **This has never been done.** Review in particular the `gatePassed` value for `repair_facts` (derived as `!attempted || succeeded`).

## Phase 3: carry the data

1. Produce the JSON dump inside Humanite with the script in the README ("how to produce the dump"), using Humanite's own Firestore credentials.
2. `cd a2h-ark && npx vite-node tools/export/cli.ts --dump dump.json --out out/`.
3. Read `out/manifest.json` and every warning. Errors stop the export and write nothing.
4. Import `out/corpus.jsonl` (dataset kind `a2h-corpus`) and `out/fixtures.jsonl` (kind `a2h-fixtures`) into BenchMarkr and publish both. Compare the item counts with Humanite's frozen corpus and fixture sets.

## Phase 4: build and load the pack

1. `cd a2h-ark && npm run build:pack` produces `dist/pack.mjs`.
2. Put the file where Node resolves `@benchmarkr/core` and `@benchmarkr/contracts` (inside the BenchMarkr checkout, or a directory whose `node_modules` links to it). They stay external on purpose: the runner matches errors with `instanceof`.
3. Start BenchMarkr with `BENCHMARKR_PACKS=/abs/path/pack.mjs`. The log line `packs.loaded` confirms it.
4. Install the benchmark package `com.humanite.a2h` through the benchmarks API.

## Phase 5: configure a run

1. Credentials: a Humanite service token (type `humanite_service_token`) and a GPTZero-compatible key for the `detector` role.
2. Target profile: config `{baseUrl, credentialId}`; the credential id must also be listed in the profile's `credentialIds`.
3. Datasets: bind `corpus` always; bind `fixtures` for A2H-04, 05, 06, 09, 10, 12, 13 and 16, which fail preflight without it.
4. Only A2H-01 to A2H-03 are on by default; A2H-07, 11, 14 and 15 are experimental.

## Phase 6: prove equivalence before any erase

The pack uses BenchMarkr's seeded sampler, not Humanite's, so samples differ from Humanite's historical runs. Equivalence of the **scoring** is covered by the ported tests. Equivalence of an **end-to-end run** has not been shown and cannot be assumed. Run a small pilot (a few sources, a few intensities) and check by hand:

- A2H-01/02 values against a Humanite run on the same sources if one exists.
- The deterministic tests (04, 05, 09, 10, 13, 16) against known fixtures.
- Known differences, which are intentional: A2H-01 and A2H-02 are separate trials (the same source and intensity is humanized twice, where Humanite shared one output); A2H-17 sees only scored trials and has no cost data; failed trials are handled by the framework, not by the scorer.

## Phase 7: the erase (owner go-ahead required)

Only after phases 1 to 6 are verified and the owner says so: follow `ERASE-LIST.md`, then delete `a2h-ark/` itself (after its contents are safely in BenchMarkr). Keep the benchmark endpoint.

## Rollback

Until Phase 7, nothing in Humanite's A2H code is touched, so rollback is "stop using the pack". After Phase 7, rollback is a git revert of the erase commit.

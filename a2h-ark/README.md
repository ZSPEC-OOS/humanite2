# The A2H ark

This directory carries **everything the A2H benchmark needs to leave Humanite**, as one standalone package. It exists for one purpose, "the Great A2H Transfer": its contents are moved into BenchMarkr, verified there, and then A2H (this directory and every file listed in `ERASE-LIST.md`) is permanently erased from Humanite so the app stands alone.

Because it will be erased, **nothing in this directory may be depended on by Humanite**, and nothing here may import from Humanite's `src/` (`@/…`), Firestore, OpenAI, or Next. Code that has to exist in both places is *vendored* (copied, with a provenance header) into `src/vendor/`. Things that must outlive the erase (the benchmark service endpoint Humanite exposes so it can be measured) live in Humanite's `src/` and are A2H-agnostic.

## Layout

| Path | What |
| --- | --- |
| `src/shared/` | Frozen copies of A2H's shared pure modules: the data types (`types.ts`), statistics, text and citation normalization, numeric parsing, fixture matching, style-contrast helpers. |
| `src/vendor/` | Frozen copies of the Humanite library code the scoring needs (style types, intensity caps and magnitude, local text diagnostics, tokenizing, sentence alignment). Each file starts with a `VENDORED from …` header. |
| `src/scoring/a2hNN.ts` | One module per test: the pure scoring core, ported from `src/lib/a2h/a2hNN.ts` with the Firestore, job and orchestration code removed. Given the same inputs it returns exactly what Humanite's A2H did. |
| `src/pack/` | The BenchMarkr side: target adapter, benchmark package (catalog, trial planning, verification, scoring, aggregation) and the pack entry point BenchMarkr loads. |
| `spec/` | The corpus as a BenchMarkr generator spec. |
| `scripts/` | Export of Humanite's stored corpus and fixtures into BenchMarkr dataset files. |
| `tests/` | Tests for all of the above (`npm test`; the pack tests need `BENCHMARKR_PATH`, see `vitest.config.ts`). |
| `TRANSFER.md` | The step-by-step runbook. |
| `ERASE-LIST.md` | Exactly what is deleted from Humanite after the transfer is verified. |

## Rules for everything in `src/scoring`

1. Pure: no I/O, no clock, no randomness, no network, no environment. Inputs in, measurements out.
2. Verbatim behaviour: copy the logic, change only imports. A refactor that changes a number is a bug.
3. Operations that call Humanite's product (humanize, repair grammar, repair facts) are **not** ported: they are performed by the target (Humanite's benchmark endpoint) and the scorer receives their output.
4. Keep what fixture curation needs (the `expected` validators and the deterministic candidate extractors): the exported fixtures are built with them.
5. Port the tests with the code.

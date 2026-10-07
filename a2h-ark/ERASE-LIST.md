# Erase list

**Not executed. Do not delete anything on this list without the owner's explicit go-ahead, and only after `TRANSFER.md` phases 1 to 6 are verified.** The list was compiled by reading the repository at commit 141e366 plus the ark branch; re-run the greps below before erasing, since the repository moves.

## 1. Delete outright

| Path | Contents |
| --- | --- |
| `src/lib/a2h/` | 50 source files and `tests/` (38 files): the A2H library. |
| `src/lib/a2hApi.ts` | Browser API client for the admin routes. |
| `src/lib/require-a2h-admin.ts` | Admin gate used by the admin routes. |
| `src/app/admin/a2h/` | The admin pages (benchmark, corpus, fixtures, topics, runs and the 17 per-test pages). |
| `src/app/api/admin/a2h/` | The admin API routes (topics, runs, per-test routes, validate, export). |
| `src/app/api/cron/a2h-worker/` | The job-queue worker route. |
| `src/components/a2h/` | `CorpusSteps.tsx`, `ResultsPageChrome.tsx`. |
| `src/components/nav/A2HMenuLink.tsx`, `src/components/nav/tests/A2HMenuLink.test.tsx` | Menu link. |
| `a2h-ark/` | This directory, after its contents are in BenchMarkr. |

## 2. Edit (small, required so the app still builds)

- `src/app/dashboard/page.tsx`: remove the `A2HMenuLink` import and its two uses (lines near 24, 324, 608).
- `tests/benchmark/tests/intensityAcceptance.test.ts` imports `pearsonCorrelation` from `@/lib/a2h/statistics`. **This test breaks when `src/lib/a2h` is deleted.** Either move that one function (it is also vendored in the ark's `src/shared/statistics.ts`) next to the test, or leave the test's dependency in a neutral module first. Do this before deleting `src/lib/a2h`.
- `vitest.config.ts` (exclude entry `a2h-ark/**`) and `tsconfig.json` (`exclude`): remove the `a2h-ark` entries when the directory goes.
- Firestore: the collections `a2hCorpusProjects`, `a2hTopics`, `a2hCorpusSources`, `a2hFixtureSets`, `a2hBenchmarkFixtures`, plus the run, job, trial, output, test-result, detector-result, repair-attempt and experiment-cohort collections named in `A2H_COLLECTIONS` (`src/lib/a2h/types.ts`). Export first (`TRANSFER.md` phase 3); deleting the data is a separate, explicit owner decision. Also check `firestore.rules` and indexes for A2H entries (none found by grep at the time of writing).
- Scheduler configuration for `/api/cron/a2h-worker`, if one exists outside this repository (not found in `vercel.json`, `firebase.json` or `.github` by grep; verify in the hosting dashboard).

## 3. Shared code that mentions A2H (decision needed, usually keep)

These are product code that happens to know A2H exists. They are not A2H and are needed by the endpoint or by sign-in:

- `a2h_admin` sign-in claim: `src/lib/accountTier.ts` (`isA2HAdmin`), `src/lib/auth-utils.ts`, `src/lib/require-auth.ts`, `src/lib/api.ts`, `src/stores/userStore.ts`, `src/app/api/v1/auth/me/route.ts`, and the tests that stub it. After the erase nothing consumes the claim. Removing it is optional cleanup and changes the token format; leave it unless the owner wants it gone.
- Comments only: `src/lib/humanizePipeline.ts`, `src/lib/runHumaniteDocument.ts`, `src/lib/evaluation/repair.ts`, `src/lib/detection/providers/gptzero.ts`, `src/app/api/v1/humanize/route.ts`, `src/lib/api.ts`, and one comment in `src/app/api/v1/billing/webhook/tests/route.test.ts`. Reword if wanted.
- **Do not delete:** `runHumaniteDocument`, `repairGrammar` (`src/lib/evaluation/repair.ts`), `repairChunk`, the humanize pipeline and the GPTZero provider. The benchmark endpoint calls them. Some carry A2H-motivated options (for example `candidateCountOverride` and candidate-selection telemetry); they stay.

## 4. Keep (survives the erase)

- `src/app/api/v1/benchmark/**`, `src/lib/benchmark-service/**`, `docs/benchmark-service.md`, `HUMANITE_BENCHMARK_TOKEN` in `.env.local.template`. These are application-agnostic and contain no A2H references.

## 5. Check after the erase

```sh
grep -rniE "a2h" src tests docs --include=* | grep -v "^a2h-ark"   # expect only the items in section 3
npx tsc --noEmit && npx vitest run                                  # Humanite's own build and tests
```

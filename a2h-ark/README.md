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
| `src/generator-specs/` | The corpus as a BenchMarkr generator spec (`corpus.json`, id `a2h-corpus`) and a typed loader (`index.ts`). |
| `tools/export/` | Export of Humanite's stored corpus and fixtures into BenchMarkr dataset files (JSONL + manifest). |
| `tests/` | Tests for all of the above (`npm test`; the pack tests need `BENCHMARKR_PATH`, see `vitest.config.ts`). |
| `TRANSFER.md` | The step-by-step runbook. |
| `ERASE-LIST.md` | Exactly what is deleted from Humanite after the transfer is verified. |

## Rules for everything in `src/scoring`

1. Pure: no I/O, no clock, no randomness, no network, no environment. Inputs in, measurements out.
2. Verbatim behaviour: copy the logic, change only imports. A refactor that changes a number is a bug.
3. Operations that call Humanite's product (humanize, repair grammar, repair facts) are **not** ported: they are performed by the target (Humanite's benchmark endpoint) and the scorer receives their output.
4. Keep what fixture curation needs (the `expected` validators and the deterministic candidate extractors): the exported fixtures are built with them.
5. Port the tests with the code.

## The corpus spec and the exported datasets

### Generator spec `a2h-corpus` (`src/generator-specs/corpus.json`)

Axes: `domain` (general, academic, business, technical, medical, legal) x `topic` (entities: `title`, `writingType`, `description`, `intendedAudience`, `coreConcepts`; default 20 per domain, max 50; proposable by the writer) x `words` (default ladder 100, 200, 300, 500, 750, 1000, 1250, 1500, 1750, 2000; a project may choose its own). Dataset kind `a2h-corpus`. The prompts are Humanite's source-text and outline prompts (GEN-V001), ported without change of intent; the temperature is left to the provider (Humanite's was a per-project optional). Checks: `non-empty` and the built-in `word-count` with bands 5% to 300 words, 4% to 1000, 3% above. These bands express Humanite's `toleranceFor` exactly (tested for every ladder length, including the boundaries), so nothing is lost there.

Generated item shape (what the generator itself can write):

| | |
| --- | --- |
| `key` | `{domain}__{topicNumber}__{words}`, e.g. `legal__7__300` (topicNumber is the entity number within its domain, unpadded) |
| `dimensions` | `{ domain: string, topic: number (the topic number), words: number (the target length) }` |
| `content` | `{ text }` only: a text-output spec stores just the answer |
| `provenance.entity` | `{ axisId: "topic", number, title }` (the other topic fields are not copied into the item) |

The export tool writes the same key and dimensions but a richer `content`, so a pack can read either: use `key`, `dimensions.{domain,topic,words}` and `content.text` (common to both); the rest below exists only in exported datasets. The generator cannot store the topic's audience, writing type, description or concepts, `wordCount` or a source hash in the item (only the prompt used them, and the word count is measured in the cell's check results), and it cannot keep Humanite's opaque `topicId`; a generated corpus is therefore not interchangeable with an exported one beyond the shared fields. There is no fixtures spec: fixtures are curated by people from the frozen corpus, not generated, so they come from the export tool.

### Export tool (`tools/export`)

```
npx vite-node tools/export/cli.ts --dump a2h-dump.json --out out/ [--project <corpusProjectId>] [--fixture-set <fixtureSetId>]
```

Writes `corpus.jsonl`, `fixtures.jsonl` and `manifest.json` (counts, source ids, and the sha256, byte size and line count of each JSONL), nothing at all if any error is found. Import the JSONL files into BenchMarkr datasets (kinds `a2h-corpus`, `a2h-fixtures`); the lines are dataset item inputs (`key`, `dimensions`, `content`, `provenance`; the hash is computed on import), sorted by key with sorted properties, so the same data gives byte-identical files and the manifest has no timestamp.

Corpus item (`corpus.jsonl`): `key` and `dimensions` as above (`dimensions` = `{domain, topic, words}`); `content` = `{ sourceId (= key), humaniteSourceId (original `projectId__topicId__targetWords`), domain, topicId, topicNumber, title, description, intendedAudience, writingType, coreConcepts[], targetWords, text, wordCount }` (`wordCount` is recomputed from the text); `provenance.humanite` holds the project, versions, model, prompt, hash and timestamps. Only `frozen` sources are exported.

Fixture item (`fixtures.jsonl`): `key` = `{corpusKey}__{type}__{ordinal}` (so a fixture is found from its source by key), `dimensions` = `{type, domain, topic, words, ordinal}`, `content` = `{ fixtureId, sourceId (= the corpus key), humaniteSourceId, type, ordinal, expected, cleanText?, corruptedText? (lifted from `expected` for the repair types, which keep them there too), sourceStart, sourceEnd, sourceText, notes, corruptionGeneratorVersion }`. The default fixture set is the highest-versioned locked set of the project.

Validation: every fixture's `expected` goes through `validateExpectedShape` and an invalid one is an error; duplicate corpus or fixture keys, a fixture whose source is not an exported frozen source, and an unknown domain or type are errors. A word count outside the tolerance band, a stored count or sha256 that disagrees with the text, and skipped non-frozen sources are warnings (reported, not enforced). Firestore is reached only through `DocSource.listDocs(collection, filter?)` (equality filters); the CLI implements it over a dump file.

### Producing the dump from Humanite

The tool reads the collections named in `A2H_COLLECTIONS`: `a2hCorpusProjects`, `a2hTopics`, `a2hCorpusSources`, `a2hFixtureSets`, `a2hBenchmarkFixtures`. A `gcloud firestore export` is a binary (LevelDB) format and cannot be read directly; produce a JSON dump instead, with a one-off script run inside Humanite (it needs Humanite's own Firestore credentials, so nothing about it lives in the ark):

```ts
// scripts/dump-a2h.ts, run in Humanite, e.g. npx tsx scripts/dump-a2h.ts > a2h-dump.json
import { A2H_COLLECTIONS as C } from '@/lib/a2h/types'
const names = [C.projects, C.topics, C.sources, C.fixtureSets, C.fixtures]
const out: Record<string, unknown[]> = {}
for (const name of names) out[name] = (await firestore.collection(name).get()).docs.map(d => ({ id: d.id, ...d.data() }))
console.log(JSON.stringify(out))
```

(`firestore` is Humanite's admin Firestore instance.) Accepted dump formats: that object (`{ "<collection>": [docs] }`), or an array / JSONL file of `{ "collection": "<name>", "id": "<docId>", "data": { ... } }` records. Documents must carry their `id` (the script above adds it). Timestamps may be strings or anything JSON-serializable; they are only copied into provenance.

### Running the tests

`npm test` runs everything. The spec and export tests import BenchMarkr's `@benchmarkr/generator` and `@benchmarkr/datasets` (and `core`, `contracts`) as TypeScript source through aliases in `vitest.config.ts` (`BENCHMARKR_PATH`, default `../../benchmarkr`) and `paths` in `tsconfig.json`; BenchMarkr's own `node_modules` supplies `zod` and `semver`, so BenchMarkr must be checked out with its dependencies installed.

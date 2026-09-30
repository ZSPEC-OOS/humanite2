import type { Domain } from '@/lib/style/types'
import type { DetectionClassification } from '@/lib/detection/contracts'

// The seed value shown when configuring a new project's length ladder — see
// §6.2 of the A2H spec for where these 10 default lengths come from. This is
// a starting suggestion only; the ladder actually in effect for a project is
// CorpusProject.lengthLadder, which can hold any admin-chosen set of
// lengths, not just this default 10.
export const DEFAULT_LENGTH_LADDER: readonly number[] = [100, 200, 300, 500, 750, 1000, 1250, 1500, 1750, 2000]

// The suggested default shown in a project's topic-count input — not a hard
// limit; see MAX_TOPICS_PER_DOMAIN for that.
export const TOPICS_PER_DOMAIN = 20

// A generous sanity ceiling on a single domain's topic count/topicNumber
// within a project, independent of whatever count that domain is actually
// configured with.
export const MAX_TOPICS_PER_DOMAIN = 50

export const DEFAULT_CORPUS_VERSION = 'CORPUS-V001'
export const DEFAULT_BENCHMARK_VERSION = 'A2H-BV001'
export const DEFAULT_GENERATION_PROMPT_VERSION = 'GEN-V001'

// Short display prefixes for topic ids (e.g. "MED-01") — cosmetic only,
// never used as a storage key.
export const DOMAIN_CODE: Record<Domain, string> = {
  general: 'GEN',
  academic: 'ACA',
  business: 'BUS',
  technical: 'TEC',
  medical: 'MED',
  legal: 'LEG',
}

// Firestore collection names shared across a2h/*.ts modules. Centralized so
// corpusProject.ts can validate a whole-corpus freeze by querying sources
// directly without importing corpus.ts (which itself imports
// getCorpusProject/markGeneratingIfNeeded from corpusProject.ts — importing
// the other way would create a circular module dependency).
export const A2H_COLLECTIONS = {
  projects: 'a2hCorpusProjects',
  topics: 'a2hTopics',
  sources: 'a2hCorpusSources',
  detectorResults: 'a2hDetectorResults',
  outputs: 'a2hBenchmarkOutputs',
  manifests: 'a2hCorpusManifests',
  runs: 'a2hBenchmarkRuns',
  runSources: 'a2hBenchmarkRunSources',
  jobs: 'a2hBenchmarkJobs',
  testResults: 'a2hBenchmarkTestResults',
  fixtureSets: 'a2hFixtureSets',
  fixtures: 'a2hBenchmarkFixtures',
  repairAttempts: 'a2hBenchmarkRepairAttempts',
} as const

// This deployment has exactly one detector integration path for A2H
// (GPTZero, via the admin's own key — see baseline.ts) and no UI yet for
// choosing between multiple named detector configurations, so a single
// constant stands in for "the detector configuration currently in effect."
// Every DetectorResult still carries its own detectorConfigId rather than
// assuming this constant, so a future multi-configuration feature is additive
// (new configs get their own id) rather than a schema change.
export const DEFAULT_DETECTOR_CONFIG_ID = 'gptzero-default'

export type CorpusProjectStatus = 'draft' | 'blueprint_locked' | 'generating' | 'frozen' | 'archived'

// The top-level, isolated unit everything else in A2H is scoped to. Every
// topic, source, and detector result carries this project's id, and every
// uniqueness/query key includes it — two projects (e.g. the standard
// 6-domain/20-topic/10-length run and a smaller experiment) never share or
// collide with each other's data, even though both exist in the same
// Firestore collections. A project's own domains/topic counts/length ladder
// are the single configuration object for everything generated under it —
// there is no separate global config anywhere else.
//
// Corpus configuration ends at the frozen source document. Intensity is a
// benchmark-execution parameter (how hard to humanize a frozen source), not
// a corpus-design parameter, so it deliberately does not live here — see the
// (future) Benchmark Run object.
//
// topicCountByDomain is a derived/persisted convenience: it is always
// recomputed from topicCountDefault and topicCountOverrides by
// corpusProject.ts, never set independently, so the two can never disagree.
// The common case (identical topic count across every domain) needs no
// per-domain input at all; topicCountOverrides exists only for the domains
// an admin explicitly deviates from the default.
export interface CorpusProject {
  id: string
  name: string
  benchmarkVersion: string
  corpusVersion: string
  domains: Domain[]
  topicCountDefault: number
  topicCountOverrides: Partial<Record<Domain, number>>
  topicCountByDomain: Partial<Record<Domain, number>>
  lengthLadder: number[]
  status: CorpusProjectStatus
  createdAt: string
  updatedAt: string
  frozenAt: string | null
}

// An immutable, independently-verifiable record of exactly what a frozen
// corpus contains — written once, by freezeCorpusProject, after the whole
// source matrix has been validated complete. topicBlueprintHash and
// manifestHash let a downstream consumer (or a later audit) confirm the
// corpus a benchmark run claims to use is bit-for-bit the one that was
// frozen, without re-deriving the entire matrix by hand.
export interface CorpusManifest {
  corpusProjectId: string
  name: string
  benchmarkVersion: string
  corpusVersion: string
  domains: Domain[]
  topicCountByDomain: Partial<Record<Domain, number>>
  lengthLadder: number[]
  expectedSourceCount: number
  actualSourceCount: number
  topicBlueprintHash: string
  sourceHashes: Record<string, string>
  manifestHash: string
  frozenAt: string
}

// A topic family — the outline a human curator (not this generation code)
// defines once per domain slot within a project; every one of its lengths is
// generated from the same topic/audience/writingType/coreConcepts, per
// §6.1's matched topic-by-length design.
export interface BenchmarkTopic {
  id: string
  corpusProjectId: string
  domainId: Domain
  topicNumber: number
  title: string
  description: string
  intendedAudience: string
  writingType: string
  coreConcepts: string[]
  generationPromptVersion: string
  enabled: boolean
  createdAt: string
  updatedAt: string
}

// 'validation_failed' is not an error state to retry blindly — it means the
// model's output word count fell outside wordCountTolerance.ts's tolerance
// band for that length and needs either a regeneration or a human look.
export type CorpusSourceStatus = 'validated' | 'validation_failed' | 'frozen'

// One generated document — a single cell in a project's topic x length
// matrix. Per §8/§20, the complete generation prompt, provider/model, and
// raw output are retained so every downstream measurement is reproducible
// from stored raw records, not just from a derived summary.
export interface CorpusSource {
  id: string
  corpusProjectId: string
  domainId: Domain
  topicId: string
  targetWords: number
  actualWords: number
  generatorProvider: string
  generatorModel: string
  generationPrompt: string
  generationPromptVersion: string
  temperature: number | null
  seed: number | null
  text: string
  sha256: string
  generatedAt: string
  frozenAt: string | null
  status: CorpusSourceStatus
}

export type BenchmarkOutputStatus = 'success' | 'failed'

// One Humanize transformation of a frozen source at a single intensity
// (1-10) within one specific Benchmark Run — the repeated-measures unit
// §1/§9 describe: the same frozen source run through the real product
// pipeline once per intensity level. Scoped by runId (not just sourceId x
// intensity) because two runs against the same frozen corpus — a different
// model, a different Humanite version, or simply a repeat for statistical
// power — must never share or overwrite each other's outputs; doc id is
// `${runId}__${sourceId}__${intensity}`, enforcing UNIQUE(runId, sourceId,
// intensity).
export interface BenchmarkOutput {
  id: string
  runId: string
  corpusProjectId: string
  sourceId: string
  domainId: Domain
  topicId: string
  targetWords: number
  intensity: number
  outputText: string
  outputWords: number
  outputSha256: string
  modelProvider: string
  model: string
  latencyMs: number
  // modelCalls/candidateCount are nullable because the current Humanize
  // pipeline (humanizeChunk) doesn't surface a per-call count distinct from
  // retryCount — null rather than fabricated, same posture as the token
  // fields below.
  modelCalls: number | null
  retryCount: number
  candidateCount: number | null
  inputTokens: number | null
  outputTokens: number | null
  estimatedCostUsd: number | null
  generatedAt: string
  status: BenchmarkOutputStatus
  errorCode: string | null
  errorMessage: string | null
}

// ── Benchmark Run engine ────────────────────────────────────────────────
//
// Everything below this point is the benchmark-EXECUTION layer, built on
// top of a frozen CorpusProject but never mutating it. A frozen corpus is
// reusable across arbitrarily many independent BenchmarkRuns — intensity,
// model, and test selection are run parameters, not corpus configuration.

export type BenchmarkRunStatus = 'draft' | 'validated' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'

// Only A2H-01/02/03 are implemented by this phase (see IMPLEMENTED_A2H_TESTS)
// — the remaining codes exist in the type now so the generic
// BenchmarkTestResult/BenchmarkJob architecture doesn't need another schema
// migration when A2H-04..17 are built.
export type A2HTestCode =
  | 'A2H-01' | 'A2H-02' | 'A2H-03' | 'A2H-04' | 'A2H-05' | 'A2H-06' | 'A2H-07' | 'A2H-08' | 'A2H-09'
  | 'A2H-10' | 'A2H-11' | 'A2H-12' | 'A2H-13' | 'A2H-14' | 'A2H-15' | 'A2H-16' | 'A2H-17'

// Phase 2 adds the first fixture-backed deterministic tests (A2H-04/05/09/10/13)
// on top of Phase 1's detector-based A2H-01/02/03. A2H-06/07/08/11/12/14-17
// remain unimplemented — the type carries every code now so the generic
// BenchmarkTestResult/BenchmarkJob/DeterministicEvaluator architecture never
// needs another schema migration as later phases fill them in.
export const IMPLEMENTED_A2H_TESTS: readonly A2HTestCode[] = [
  'A2H-01', 'A2H-02', 'A2H-03', 'A2H-04', 'A2H-05', 'A2H-09', 'A2H-10', 'A2H-13',
  'A2H-06', 'A2H-08', 'A2H-12',
]

// A new run defaults to the detector-based tests only (§4's "almost no
// configuration" standard case) — the fixture-backed tests below are valid
// choices (IMPLEMENTED_A2H_TESTS includes them) but never auto-enabled,
// since enabling one requires an admin to first pick a locked fixture set;
// defaulting them on would make every new run invalid until that extra step
// happens.
export const DEFAULT_ENABLED_TESTS: readonly A2HTestCode[] = ['A2H-01', 'A2H-02', 'A2H-03']

export const A2H_TEST_LABELS: Record<A2HTestCode, string> = {
  'A2H-01': 'A2H-01 GPTZero AI-to-Human Conversion',
  'A2H-02': 'A2H-02 Intensity Response',
  'A2H-03': 'A2H-03 Length Performance',
  'A2H-04': 'A2H-04 Citation Preservation',
  'A2H-05': 'A2H-05 Numeric & Unit Preservation',
  'A2H-06': 'A2H-06 Grammar Repair',
  'A2H-07': 'A2H-07 Repeatability',
  'A2H-08': 'A2H-08 Grammar Damage',
  'A2H-09': 'A2H-09 Negation & Modality Preservation',
  'A2H-10': 'A2H-10 Protected-Term Preservation',
  'A2H-11': 'A2H-11 Style/Tone Control',
  'A2H-12': 'A2H-12 Factual Repair',
  'A2H-13': 'A2H-13 Terminology Consistency',
  'A2H-14': 'A2H-14 Genre/Audience',
  'A2H-15': 'A2H-15 Candidate Selection',
  'A2H-16': 'A2H-16 Claim Relationships',
  'A2H-17': 'A2H-17 Operational Efficiency',
}

export const DEFAULT_TEST_VERSION = 'A2H-TV001'

// ── Fixture / annotation layer (Phase 2) ────────────────────────────────
//
// Fixtures annotate a frozen source — they never mutate CorpusSource.text/
// sha256, the topic blueprint, or the corpus manifest (§53). A fixture set
// belongs to exactly one Corpus Project and is versioned independently of
// the corpus/benchmark version; once locked it is immutable, and a
// correction becomes a new fixture-set version (FIXTURE-V002, ...) rather
// than a mutation of locked benchmark truth (§2/§26).
// Phase 3 adds two CONTROLLED DERIVATIVE fixture types — grammar_repair and
// factual_repair. Unlike citation/numeric_unit/modality/protected_term/
// terminology (which annotate expectations about a frozen source's own
// text), these two fixtures carry a deliberately corrupted derivative of a
// source excerpt alongside its known-clean ground truth (§1-4) — never
// persisted as a CorpusSource, and never mutating the frozen source they're
// derived from.
export type A2HFixtureType =
  | 'citation' | 'numeric_unit' | 'modality' | 'protected_term' | 'terminology'
  | 'grammar_repair' | 'factual_repair'
export type FixtureSetStatus = 'draft' | 'validated' | 'locked' | 'archived'

export const DEFAULT_FIXTURE_VERSION = 'FIXTURE-V001'

// Which BenchmarkOutput-consuming test each fixture type backs — the same
// mapping run validation (§27), execution (§7/§28), and eligibility
// reporting (§29) all key off of.
// A2H-08 is deliberately absent — it scores ordinary Humanite outputs
// directly via the grammar engine and never requires a fixture set (§27,
// §47).
export const FIXTURE_TYPE_FOR_TEST: Partial<Record<A2HTestCode, A2HFixtureType>> = {
  'A2H-04': 'citation',
  'A2H-05': 'numeric_unit',
  'A2H-09': 'modality',
  'A2H-10': 'protected_term',
  'A2H-13': 'terminology',
  'A2H-06': 'grammar_repair',
  'A2H-12': 'factual_repair',
}

export const FIXTURE_REQUIRING_TESTS: readonly A2HTestCode[] = Object.keys(FIXTURE_TYPE_FOR_TEST) as A2HTestCode[]

export interface FixtureSet {
  id: string
  corpusProjectId: string
  name: string
  fixtureVersion: string
  status: FixtureSetStatus
  createdAt: string
  updatedAt: string
  lockedAt: string | null
}

// The generic, type-agnostic fixture record every one of A2H-04/05/09/10/13
// reads (§3) — `expected` holds whichever of CitationFixtureExpected /
// NumericUnitFixtureExpected / ModalityFixtureExpected /
// ProtectedTermFixtureExpected / TerminologyFixtureExpected shape its own
// `type` defines (see the corresponding a2h0N.ts module), as plain data, the
// same pattern BenchmarkTestResult.measurements already uses for per-test
// shapes. sourceStart/sourceEnd/sourceText are optional provenance —
// exactly where in the frozen source this fixture was found/curated —
// useful for admin review but not required for evaluation.
export interface BenchmarkFixture {
  id: string
  fixtureSetId: string
  corpusProjectId: string
  sourceId: string
  type: A2HFixtureType
  ordinal: number
  expected: Record<string, unknown>
  sourceStart: number | null
  sourceEnd: number | null
  sourceText: string | null
  notes: string | null
  createdAt: string
  updatedAt: string
  // Set only for grammar_repair/factual_repair fixtures whose corrupted
  // derivative was produced by a deterministic corruption generator (§4,
  // §29-30) rather than hand-authored — versioned separately from the
  // fixture set's own FIXTURE-Vnnn so a generator change never silently
  // reinterprets an already-locked fixture's provenance. Null for every
  // other fixture type, and for manually-authored derivative fixtures.
  corruptionGeneratorVersion: string | null
}

// A documented common shape every controlled-derivative fixture's `expected`
// conforms to (§3) — GrammarRepairFixtureExpected (a2h06.ts) and
// FactualRepairFixtureExpected (a2h12.ts) are its two concrete, narrower
// specializations (each fixing `corruptionCategory` to its own closed enum
// via a differently-named field); this interface exists for documentation
// and cross-module reference, not as a type either module imports directly.
export interface ControlledDerivativeFixtureExpected {
  cleanText: string
  corruptedText: string
  corruptionCategory: string
  targetStart?: number | null
  targetEnd?: number | null
  incorrectText?: string | null
  expectedCorrection?: string | null
  anchorText?: string | null
  metadata?: Record<string, unknown>
}

// A named, versioned execution against a frozen corpus. Every field that
// affects reproducibility is captured here at creation/validation time and
// never re-resolved later from mutable settings (a user changing their
// configured model after a run starts must not retroactively change what
// that run claims to have measured).
export interface BenchmarkRun {
  id: string
  corpusProjectId: string
  name: string
  benchmarkVersion: string
  testVersion: string
  corpusManifestHash: string
  humaniteVersion: string
  gitCommit: string
  modelProvider: string
  model: string
  detectorConfigId: string | null
  selectedDomains: Domain[]
  selectedTopicIds: string[]
  selectedLengths: number[]
  intensities: number[]
  enabledTests: A2HTestCode[]
  // Snapshotted at validation time (§4), never re-resolved from a mutable
  // "current fixture set" later — null until a run enables one of
  // FIXTURE_REQUIRING_TESTS and is validated. Both are set together: a run
  // with fixtureSetId set always has fixtureVersion set, and vice versa.
  fixtureSetId: string | null
  fixtureVersion: string | null
  // Snapshotted at creation time (§24, §41-42) — V1 ships exactly one fixed
  // configuration of each, so these are always set (never null) rather than
  // resolved lazily like fixtureVersion, which genuinely depends on an
  // admin's later choice of fixture set.
  repairConfigVersion: string
  grammarEngineConfigVersion: string
  concurrency: number
  status: BenchmarkRunStatus
  createdAt: string
  updatedAt: string
  validatedAt: string | null
  startedAt: string | null
  completedAt: string | null
}

// The frozen source cohort for one run, written once by validateRun (never
// re-inferred from filters later) — doc id `${runId}__${sourceId}` enforces
// UNIQUE(runId, sourceId). sourceSha256 is copied at snapshot time so a
// cohort record remains independently verifiable against the corpus
// manifest even without re-reading the source itself.
export interface BenchmarkRunSource {
  id: string
  runId: string
  corpusProjectId: string
  sourceId: string
  domainId: Domain
  topicId: string
  targetWords: number
  sourceSha256: string
}

// GPTZero is the only detector this deployment integrates for A2H (see
// baseline.ts) — always called directly, never through the product's
// swappable DetectionGateway, because the detector itself must never be
// gradeable by or dependent on whatever produced the text.
export type DetectorName = 'gptzero'
export type DetectorStage = 'baseline' | 'post_transform'

// A single GPTZero call's complete result, immutable once written. A
// 'baseline' result (outputId: null) is keyed by (sourceId,
// detectorConfigId) and is deliberately NOT run-scoped in its identity —
// per §8, the exact same frozen source scored under the exact same detector
// configuration must never be paid for twice just because a second run
// references it; runId here records only which run first produced it. A
// 'post_transform' result IS effectively run-scoped, because it's keyed by
// outputId, and outputId itself already encodes runId (see BenchmarkOutput).
export interface DetectorResult {
  id: string
  corpusProjectId: string
  runId: string
  sourceId: string
  outputId: string | null
  detector: DetectorName
  detectorConfigId: string
  stage: DetectorStage
  aiProbability: number | null
  humanProbability: number | null
  mixedProbability: number | null
  classification: DetectionClassification
  analyzedAt: string
  rawResponse: unknown
}

// The generic, code-agnostic result row every A2H-0N test writes into — built
// now specifically so A2H-04 through A2H-17 plug into this same table
// instead of each getting its own bespoke schema. `measurements` holds
// whatever shape a given test code defines (e.g. A2H01Measurements) as plain
// data; `passed`/`score` are the two universal fields a cross-test summary
// view can read without knowing each test's own measurement shape.
export interface BenchmarkTestResult {
  id: string
  corpusProjectId: string
  runId: string
  sourceId: string
  outputId: string | null
  // Set for fixture-scoped tests (A2H-06/A2H-12 — one row per controlled
  // derivative fixture, since there is no BenchmarkOutput to key on), null
  // for every output-scoped test (A2H-01/02/04/05/08/09/10/13). Exactly one
  // of outputId/fixtureId is ever non-null.
  fixtureId: string | null
  benchmarkCode: A2HTestCode
  testVersion: string
  passed: boolean | null
  score: number | null
  measurements: Record<string, unknown>
  evaluatedAt: string
}

// ── Checkpoint / job model ──────────────────────────────────────────────
//
// A BenchmarkJob is a persisted checkpoint record, not a message on a queue
// — this deployment has no background worker process, so "enqueueing" a job
// means writing its row with status 'queued', and "running" it means an
// interactive, admin-driven API call picks up queued rows and executes them
// synchronously (see runs.ts's executeRunBatch). What matters for §10/§11/§26
// is job IDENTITY: each job's id is deterministic from its logical key (run +
// source [+ intensity | + output+detectorConfig | + output+code+version]), so
// creating "the same" job twice — from a page refresh, a retried click, or a
// resumed run — always resolves to the same row instead of duplicating
// tracked (and potentially billable) work.
// 'repair_evaluation' (Phase 3) is operationally distinct from
// 'test_evaluation': it makes paid model calls (a targeted repair attempt
// via repairChunk/repairGrammar) rather than pure local computation, so
// it's kept as its own stage even though both stages ultimately write a
// BenchmarkTestResult (§25).
export type BenchmarkJobStage = 'baseline_gptzero' | 'humanite_transform' | 'post_gptzero' | 'test_evaluation' | 'repair_evaluation'
export type BenchmarkJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'retrying' | 'cancelled'

// ── Deterministic evaluator contract (Phase 2, §8) ──────────────────────
//
// Defined here (not in deterministicEvaluators.ts) so every a2h0N.ts module
// can import these two types without creating a circular value-import with
// the registry that imports each module's evaluator function.
export interface DeterministicTestContext {
  run: BenchmarkRun
  source: CorpusSource
  output: BenchmarkOutput
  fixtures: BenchmarkFixture[]
}

export interface DeterministicEvaluation {
  passed: boolean | null
  score: number | null
  measurements: Record<string, unknown>
}

export type DeterministicEvaluator = (ctx: DeterministicTestContext) => DeterministicEvaluation

export interface BenchmarkJob {
  id: string
  runId: string
  corpusProjectId: string
  stage: BenchmarkJobStage
  sourceId: string
  outputId: string | null
  // Set only for 'repair_evaluation' jobs — which controlled derivative
  // fixture (grammar_repair or factual_repair) this job repairs and scores.
  fixtureId: string | null
  intensity: number | null
  benchmarkCode: A2HTestCode | null
  status: BenchmarkJobStatus
  attemptCount: number
  createdAt: string
  startedAt: string | null
  completedAt: string | null
  errorCode: string | null
  errorMessage: string | null
}

// ── Repair attempts (Phase 3) ────────────────────────────────────────────
//
// A2H-06/A2H-12 invoke a targeted, paid repair call against a controlled
// derivative fixture rather than the ordinary source×intensity Humanize
// pipeline — this is deliberately NOT a BenchmarkOutput (§22): it has no
// intensity, no domain-matched candidate selection, and its identity is
// (run, fixture, benchmarkCode, repairConfigVersion), not
// (run, source, intensity).
export const DEFAULT_REPAIR_CONFIG_VERSION = 'REPAIR-V001'

// V1 ships exactly one fixed repair configuration (§24) — no per-run
// customization yet. Documented here so a later version bump has a place to
// register what changed; the concrete values live next to repairChunk/
// repairGrammar in evaluation/repair.ts.
export interface RepairConfigSnapshot {
  repairVersion: string
  modelProvider: string
  model: string
  tone: string
  domainHandling: string
  maxRetries: number
}

export type BenchmarkRepairStatus = 'success' | 'failed'

export interface BenchmarkRepairAttempt {
  id: string
  runId: string
  corpusProjectId: string
  fixtureSetId: string
  fixtureId: string
  benchmarkCode: 'A2H-06' | 'A2H-12'
  sourceId: string
  corruptedInput: string
  repairedOutput: string | null
  modelProvider: string
  model: string
  latencyMs: number
  modelCalls: number | null
  retryCount: number
  inputTokens: number | null
  outputTokens: number | null
  estimatedCostUsd: number | null
  status: BenchmarkRepairStatus
  errorCode: string | null
  errorMessage: string | null
  createdAt: string
  // §51's minimal audit trail: the default (idempotent) path always writes
  // attemptNumber 1 with supersedesAttemptId null and reuses that same doc
  // on every later resume/retry. An explicit admin regeneration (never the
  // automatic job pipeline) creates a NEW doc with an incremented
  // attemptNumber pointing at the one it supersedes — the prior attempt's
  // paid evidence is never overwritten or deleted.
  attemptNumber: number
  supersedesAttemptId: string | null
}

// ── Grammar engine (Phase 3, §13-14) ─────────────────────────────────────
//
// A fixed, versioned, deterministic (non-LLM) grammar/spelling detector —
// see grammarEngine.ts for the concrete rule set. Every A2H-08 result (and
// every A2H-06 classification) must be reproducible from this exact
// engine/version/rule configuration; a later rule change requires a new
// version, and historical results stay tied to whichever version produced
// them (§41).
export interface GrammarEngineConfig {
  engine: string
  version: string
  language: string
  disabledRules: string[]
  configHash: string
}

export interface GrammarFinding {
  ruleId: string
  category: string
  message: string
  start: number
  end: number
  text: string
  suggestions: string[]
}

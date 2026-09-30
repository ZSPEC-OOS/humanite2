import type { Domain } from '@/lib/style/types'

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
} as const

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
// (1-10) — the repeated-measures unit §1/§9 describe: the same frozen
// source run through the real product pipeline once per intensity level.
export interface BenchmarkOutput {
  id: string
  corpusProjectId: string
  sourceId: string
  domainId: Domain
  topicId: string
  targetWords: number
  intensity: number
  outputText: string
  outputWords: number
  outputSha256: string
  modelUsed: string
  retryCount: number
  candidateCount: number
  latencyMs: number
  // Not available from the current humanize pipeline (humanizeChunk doesn't
  // surface completion usage) — null rather than fabricated; see outputs.ts.
  inputTokens: number | null
  outputTokens: number | null
  estimatedCostUsd: number | null
  generatedAt: string
  status: BenchmarkOutputStatus
  errorMessage: string | null
}

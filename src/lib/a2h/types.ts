import type { Domain } from '@/lib/style/types'

// The 10 matched document lengths every topic family generates independently
// — see §6.2 of the A2H spec. Order matters for UI display (the corpus
// matrix renders columns in this order); membership matters for validation
// (targetWords must be one of these, not an arbitrary number).
export const LENGTH_LADDER: readonly number[] = [100, 200, 300, 500, 750, 1000, 1250, 1500, 1750, 2000]

// The suggested default shown in the topic-count input before an admin
// locks in a domain's own count — not a hard limit; see MAX_TOPICS_PER_DOMAIN
// for that.
export const TOPICS_PER_DOMAIN = 20

// A generous sanity ceiling on a single domain's topic count/topicNumber,
// independent of whatever count a given domain is actually locked to.
export const MAX_TOPICS_PER_DOMAIN = 50

export const DEFAULT_CORPUS_VERSION = 'CORPUS-V001'
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

// A domain's own topic-count configuration — set once, then locked before
// bulk outline generation is allowed, so the roster size stays fixed for the
// lifetime of everything generated against it (corpus sources, baselines,
// later transformation runs all key off a topic's slot number).
export interface DomainOutlineConfig {
  domainId: Domain
  topicCount: number
  locked: boolean
  lockedAt: string | null
  updatedAt: string
}

// A topic family — the outline a human curator (not this generation code)
// defines once per domain slot; every one of its 10 lengths is generated
// from the same topic/audience/writingType/coreConcepts, per §6.1's matched
// topic-by-length design.
export interface BenchmarkTopic {
  id: string
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

// One generated document — a single cell in the topic x length matrix. Per
// §8/§20, the complete generation prompt, provider/model, and raw output are
// retained so every downstream measurement is reproducible from stored raw
// records, not just from a derived summary.
export interface CorpusSource {
  id: string
  corpusVersion: string
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

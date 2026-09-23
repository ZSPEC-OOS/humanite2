// Detection contracts (permanent GPTZero architecture, schema v3.0).
// Shared by /api/v1/scan and the post-humanize auto-check in
// /api/v1/humanize, so both use the same contract instead of two copies
// drifting apart.

export type DetectionClassification = 'human-written' | 'ai-generated' | 'mixed' | 'uncertain'
export type ConfidenceCategory = 'high' | 'medium' | 'low' | 'unknown'

export interface ProviderInfo {
  id: string
  model?: string
  version?: string
}

export interface ProbabilitySet {
  human: number | null
  ai: number | null
  mixed: number | null
}

// A per-sentence detection result. 'mixed' is deliberately excluded from a
// segment's own classification: a provider calls a segment human/ai/
// uncertain, and it's the document-level aggregate that can be 'mixed'.
export interface DetectionSegment {
  id: string
  text?: string
  // A segment knows it lacks an offset/classification when sentence-
  // matching against the original text fails, or a score is missing — an
  // explicit `undefined` rather than an omitted key, hence `| undefined`
  // alongside `?:` here.
  start_char?: number | undefined
  end_char?: number | undefined
  classification?: 'human-written' | 'ai-generated' | 'uncertain' | undefined
  ai_score: number | null
  highlighted_for_ai: boolean
  source: string
}

export interface LocalDiagnostics {
  word_count: number
  sentence_count: number
  paragraph_count: number
  average_sentence_length: number
  sentence_length_stddev: number
  lexical_diversity: number
  contraction_rate: number
  first_person_rate: number
  repeated_bigram_rate: number
  repeated_trigram_rate: number
  question_rate: number
  readability_score: number | null
}

export interface DetectionExplanation {
  summary: string
  detail?: string
}

export interface DetectionResult {
  schema_version: '3.0'
  provider: ProviderInfo
  classification: DetectionClassification
  probabilities: ProbabilitySet
  predicted_class_probability: number | null
  confidence_category: ConfidenceCategory
  // Derived from segment-level results when the provider response is
  // granular enough to support it (spec §13) — never manufactured from
  // probabilities.ai alone, and null when there isn't enough signal.
  estimated_ai_like_fraction: number | null
  segments: DetectionSegment[]
  diagnostics: LocalDiagnostics | null
  processing_duration_ms: number
  warnings: string[]
  explanation: DetectionExplanation | null
}

export type DetectionErrorCode =
  | 'INVALID_INPUT'
  | 'TEXT_TOO_SHORT'
  | 'TEXT_TOO_LARGE'
  | 'PROVIDER_UNAUTHORIZED'
  | 'PROVIDER_RATE_LIMITED'
  | 'PROVIDER_TIMEOUT'
  | 'PROVIDER_UNAVAILABLE'
  | 'INVALID_PROVIDER_RESPONSE'

export class DetectionProviderError extends Error {
  constructor(
    public code: DetectionErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'DetectionProviderError'
  }
}

export interface DetectionOptions {
  mode?: 'quick' | 'standard'
  domainHint?: string
}

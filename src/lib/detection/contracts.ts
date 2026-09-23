// Shared by /api/v1/scan and the post-humanize auto-check in
// /api/v1/humanize, so both use the same detector contract instead of two
// copies drifting apart.

export interface FeatureContribution {
  feature: string
  observed_value: number
  direction: 'ai_indicator' | 'human_indicator'
  contribution: number
}

// A contiguous, smoothed region of the analyzed text (not a raw inference
// window — overlapping windows are merged/smoothed server-side; see
// services/scanner/src/aggregation/document.py). Char offsets are into the
// exact text that was sent to the scanner, so the UI can highlight the
// original text without re-tokenizing.
export interface DetectionSegment {
  id: string
  start_char: number
  end_char: number
  start_token: number
  end_token: number
  ai_probability: number
  classification: 'human-written' | 'ai-generated' | 'uncertain'
  confidence: number
}

export interface Coverage {
  analyzed_tokens: number
  total_tokens: number
  fraction: number
}

export interface ClassifyResult {
  classification: 'human-written' | 'ai-generated' | 'mixed' | 'uncertain'
  confidence: number
  human_probability: number
  ai_probability: number
  uncertain_probability: number
  // Token-level reconstruction across the whole document (spec §9) — the
  // number to display as "Estimated AI-like content". ai_probability
  // mirrors this for backward compatibility.
  ai_fraction: number
  coverage: Coverage
  segments: DetectionSegment[]
  per_sentence_perplexity: number[]
  top_features: FeatureContribution[]
  explanation: { summary: string; detail: string }
  model_used: string
  processing_duration_ms: number | null
}

export type DetectorErrorCode =
  | 'INVALID_INPUT'
  | 'TEXT_TOO_SHORT'
  | 'DETECTOR_TIMEOUT'
  | 'DETECTOR_UNAVAILABLE'
  | 'INFERENCE_ERROR'

export class DetectorError extends Error {
  constructor(
    public code: DetectorErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'DetectorError'
  }
}

// ── v3.0 contracts (permanent GPTZero architecture) ──────────────────────
// Coexists with the v2 types above during the provider migration. The types
// above stay wired to services/scanner until the API routes and stores are
// switched over to DetectionGateway; once that lands, v2 is deleted rather
// than kept as a compatibility layer.

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

// GPTZero-era segment shape — distinct from the v2 DetectionSegment above,
// which is keyed to the proprietary scanner's token-window aggregation.
// 'mixed' is deliberately excluded: a provider calls a segment human/ai/
// uncertain, and it's the document-level aggregate that can be 'mixed'.
export interface DetectionSegmentV3 {
  id: string
  text?: string
  // GPTZero-derived segments know they lack an offset/classification when
  // sentence-matching fails or a score is missing — an explicit `undefined`
  // rather than an omitted key, hence `| undefined` alongside `?:` here.
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
  segments: DetectionSegmentV3[]
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

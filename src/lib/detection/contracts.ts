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

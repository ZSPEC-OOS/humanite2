// Shared by /api/v1/scan and the post-humanize auto-check in
// /api/v1/humanize, so both use the same detector contract instead of two
// copies drifting apart.

export interface FeatureContribution {
  feature: string
  observed_value: number
  direction: 'ai_indicator' | 'human_indicator'
  contribution: number
}

export interface ClassifyResult {
  classification: 'human-written' | 'ai-generated' | 'mixed' | 'uncertain'
  confidence: number
  human_probability: number
  ai_probability: number
  uncertain_probability: number
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

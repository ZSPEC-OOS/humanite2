import { ClassifyResult, Coverage, DetectionResult, DetectionSegment, DetectionSegmentV3 } from './contracts'

// Bridges the v3.0 DetectionResult (DetectionGateway/GPTZero) into the v2
// ClassifyResult shape /api/v1/scan and /api/v1/humanize still return, so
// scanStore, ScanReport, and the dashboard keep working unchanged while
// DetectionGateway replaces services/scanner underneath them. Delete this
// once Phase 5 moves those consumers onto DetectionResult directly.
export function toLegacyClassifyResult(result: DetectionResult, originalText: string): ClassifyResult {
  const confidence = round(result.predicted_class_probability ?? 0.5)
  const uncertainProbability = result.classification === 'uncertain' ? round(1 - confidence) : 0

  return {
    classification: result.classification,
    confidence,
    human_probability: result.probabilities.human ?? 0,
    ai_probability: result.probabilities.ai ?? 0,
    uncertain_probability: uncertainProbability,
    // Same fallback the old client.ts used when a document-level fraction
    // isn't available: the AI-class probability as the next best estimate.
    ai_fraction: result.estimated_ai_like_fraction ?? result.probabilities.ai ?? 0,
    coverage: buildCoverage(originalText),
    segments: result.segments.map(toLegacySegment),
    // GPTZero doesn't expose these — the proprietary scanner's window-level
    // feature vector and GPT-2 perplexity chart have no v3.0 equivalent.
    per_sentence_perplexity: [],
    top_features: [],
    explanation: {
      summary: result.explanation?.summary ?? '',
      detail: result.explanation?.detail ?? '',
    },
    model_used: result.provider.id,
    processing_duration_ms: result.processing_duration_ms,
  }
}

function buildCoverage(originalText: string): Coverage {
  // GPTZero has no windowing/sampling concept — it always analyzes the
  // whole document in one call, unlike the old scanner's partial-coverage
  // quick mode.
  const words = originalText.trim() ? originalText.trim().split(/\s+/).length : 0
  return { analyzed_tokens: words, total_tokens: words, fraction: 1 }
}

function toLegacySegment(seg: DetectionSegmentV3, index: number): DetectionSegment {
  const start = seg.start_char ?? 0
  const end = seg.end_char ?? start
  const aiProbability = seg.ai_score ?? 0.5

  return {
    id: seg.id,
    start_char: start,
    end_char: end,
    // GPTZero doesn't report token offsets — nothing downstream currently
    // reads these beyond distinguishing one segment from the next.
    start_token: index,
    end_token: index + 1,
    ai_probability: aiProbability,
    classification: seg.classification ?? 'uncertain',
    // Distance from the maximally-uncertain midpoint, scaled to 0-1 — a
    // stand-in for the old per-window classifier confidence, which GPTZero
    // doesn't report per sentence.
    confidence: round(Math.abs(aiProbability - 0.5) * 2),
  }
}

function round(n: number): number {
  return Math.round(n * 10000) / 10000
}

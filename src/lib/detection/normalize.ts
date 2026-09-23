import {
  ConfidenceCategory,
  DetectionClassification,
  DetectionProviderError,
  DetectionSegment,
  ProbabilitySet,
} from './contracts'
import { DetectionProviderResult } from './providers/provider'

// GPTZero's documented shape nests the per-document result under
// `documents[]`; some responses return the single result flat at the top
// level instead. Field names below cover both naming schemes GPTZero has
// shipped across API versions — `document_classification`/HUMAN_ONLY-style
// enums, and the older flat `classification`/human-style enum — since which
// one a given account/version returns can't be confirmed without a live key
// (see GPTZeroProvider). Anything neither shape provides falls back to a
// derived value rather than being guessed from a single field in isolation.
interface GPTZeroSentence {
  sentence?: string
  text?: string
  generated_prob?: number
  ai_score?: number
  highlight_sentence_for_ai?: boolean
}

interface GPTZeroDocumentResult {
  document_classification?: string
  classification?: string
  class_probabilities?: { human?: number; ai?: number; mixed?: number }
  confidence_category?: string
  completely_generated_prob?: number
  average_generated_prob?: number
  sentences?: GPTZeroSentence[]
}

interface GPTZeroRawResponse extends GPTZeroDocumentResult {
  documents?: GPTZeroDocumentResult[]
}

const CLASSIFICATION_MAP: Record<string, DetectionClassification> = {
  HUMAN_ONLY: 'human-written',
  MIXED: 'mixed',
  AI_ONLY: 'ai-generated',
  human: 'human-written',
  ai: 'ai-generated',
  mixed: 'mixed',
}

function round(n: number): number {
  return Math.round(n * 10000) / 10000
}

function mapClassification(raw: string | undefined, warnings: string[]): DetectionClassification {
  if (!raw) {
    warnings.push('GPTZero response did not include a classification.')
    return 'uncertain'
  }
  const mapped = CLASSIFICATION_MAP[raw]
  if (!mapped) {
    warnings.push(`Unrecognized GPTZero classification "${raw}".`)
    return 'uncertain'
  }
  return mapped
}

function buildProbabilities(doc: GPTZeroDocumentResult): ProbabilitySet {
  if (doc.class_probabilities) {
    return {
      human: doc.class_probabilities.human ?? null,
      ai: doc.class_probabilities.ai ?? null,
      mixed: doc.class_probabilities.mixed ?? null,
    }
  }
  // Older/minimal shape only reports an AI-generated probability. Human is
  // its complement; there's no independent mixed signal to report, so that
  // stays null rather than being guessed at.
  const ai = doc.completely_generated_prob ?? doc.average_generated_prob ?? null
  return {
    human: ai == null ? null : round(1 - ai),
    ai: ai == null ? null : round(ai),
    mixed: null,
  }
}

function predictedClassProbability(
  probabilities: ProbabilitySet,
  classification: DetectionClassification,
): number | null {
  switch (classification) {
    case 'human-written': return probabilities.human
    case 'ai-generated': return probabilities.ai
    case 'mixed': return probabilities.mixed
    default: return null
  }
}

function deriveConfidenceCategory(
  documented: string | undefined,
  predicted: number | null,
): ConfidenceCategory {
  const normalized = documented?.toLowerCase()
  if (normalized === 'high' || normalized === 'medium' || normalized === 'low') return normalized
  if (predicted == null) return 'unknown'
  if (predicted >= 0.8) return 'high'
  if (predicted >= 0.6) return 'medium'
  return 'low'
}

// Locates each sentence's char offsets in the original text so the UI can
// highlight it directly, rather than re-tokenizing. GPTZero's documented
// sentence objects don't carry offsets themselves.
function buildSegments(sentences: GPTZeroSentence[] | undefined, originalText: string): DetectionSegment[] {
  if (!sentences?.length) return []
  let cursor = 0

  return sentences.map((s, i) => {
    const text = s.sentence ?? s.text ?? ''
    const start = text ? originalText.indexOf(text, cursor) : -1
    const end = start === -1 ? undefined : start + text.length
    if (start !== -1) cursor = end!

    const ai_score = s.generated_prob ?? s.ai_score ?? null
    const highlighted_for_ai = s.highlight_sentence_for_ai ?? (ai_score != null && ai_score >= 0.5)
    const classification =
      ai_score == null ? undefined
      : ai_score >= 0.6 ? 'ai-generated'
      : ai_score <= 0.4 ? 'human-written'
      : 'uncertain'

    return {
      id: `gptzero-seg-${i}`,
      text,
      start_char: start === -1 ? undefined : start,
      end_char: end,
      classification,
      ai_score,
      highlighted_for_ai,
      source: 'gptzero',
    }
  })
}

// Spec §13 — derived only when the response is granular enough to support
// it (per-sentence scores present); never manufactured from
// probabilities.ai alone.
function estimateAiLikeFraction(segments: DetectionSegment[]): number | null {
  const scored = segments.filter((s): s is DetectionSegment & { ai_score: number } => s.ai_score != null)
  if (scored.length === 0) return null
  return round(scored.reduce((sum, s) => sum + s.ai_score, 0) / scored.length)
}

export function normalizeGPTZero(raw: unknown, originalText: string): DetectionProviderResult {
  if (typeof raw !== 'object' || raw === null) {
    throw new DetectionProviderError('INVALID_PROVIDER_RESPONSE', 'GPTZero returned a non-object response.')
  }

  const body = raw as GPTZeroRawResponse
  const doc = body.documents?.[0] ?? body
  const warnings: string[] = []

  const classification = mapClassification(doc.document_classification ?? doc.classification, warnings)
  const probabilities = buildProbabilities(doc)
  const predicted_class_probability = predictedClassProbability(probabilities, classification)
  const confidence_category = deriveConfidenceCategory(doc.confidence_category, predicted_class_probability)
  const segments = buildSegments(doc.sentences, originalText)
  const estimated_ai_like_fraction = estimateAiLikeFraction(segments)

  return {
    schema_version: '3.0',
    provider: { id: 'gptzero' },
    classification,
    probabilities,
    predicted_class_probability,
    confidence_category,
    estimated_ai_like_fraction,
    segments,
    warnings,
    explanation: {
      summary: `GPTZero classified this text as ${classification}` +
        (predicted_class_probability != null ? ` (${Math.round(predicted_class_probability * 100)}% confidence).` : '.'),
    },
  }
}

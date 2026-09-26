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

function wordCount(text: string): number {
  const trimmed = text.trim()
  return trimmed ? trimmed.split(/\s+/).length : 0
}

// Spec §13 — derived only when the response is granular enough to support
// it (per-sentence scores present); never manufactured from
// probabilities.ai alone. Weighted by each segment's word count rather than
// a plain per-sentence average — an unweighted mean lets a one-word
// sentence ("Yes.") outvote a fifty-word one, which can put the reported
// fraction far from what share of the actual text reads as AI-like.
function estimateAiLikeFraction(segments: DetectionSegment[]): number | null {
  const scored = segments.filter((s): s is DetectionSegment & { ai_score: number } => s.ai_score != null)
  if (scored.length === 0) return null
  const weights = scored.map(s => wordCount(s.text ?? ''))
  const totalWeight = weights.reduce((sum, w) => sum + w, 0)
  // No segment carried usable text to weight by (shouldn't normally happen —
  // segments come from the same sentence list their scores do) — an
  // unweighted mean is still a better answer than null or a division by zero.
  if (totalWeight === 0) {
    return round(scored.reduce((sum, s) => sum + s.ai_score, 0) / scored.length)
  }
  const weightedSum = scored.reduce((sum, s, i) => sum + s.ai_score * weights[i]!, 0)
  return round(weightedSum / totalWeight)
}

// Sapling's documented response is a single scalar score (0 = confidently
// human, 1 = confidently AI) plus an optional sentence_scores array — no
// independent classification enum and no "mixed" signal the way GPTZero's
// three-way class_probabilities gives us. AI_SCORE_THRESHOLD/HUMAN_SCORE_THRESHOLD
// mirror the 0.6/0.4 bands GPTZero's own per-segment classification already
// uses elsewhere in this file, so a "confidently ai" or "confidently human"
// sentence means the same thing regardless of which provider produced it.
const AI_SCORE_THRESHOLD = 0.6
const HUMAN_SCORE_THRESHOLD = 0.4

interface SaplingSentenceScore {
  sentence?: string
  score?: number
}

interface SaplingRawResponse {
  score?: number
  sentence_scores?: SaplingSentenceScore[]
}

function classifyFromScore(score: number): 'ai-generated' | 'human-written' | 'uncertain' {
  if (score >= AI_SCORE_THRESHOLD) return 'ai-generated'
  if (score <= HUMAN_SCORE_THRESHOLD) return 'human-written'
  return 'uncertain'
}

// Mirrors GPTZero's buildSegments: locates each sentence's char offsets in
// the original text so the UI can highlight it directly. Sapling's
// sentence_scores entries don't carry offsets themselves either.
function buildSaplingSegments(sentenceScores: SaplingSentenceScore[] | undefined, originalText: string): DetectionSegment[] {
  if (!sentenceScores?.length) return []
  let cursor = 0

  return sentenceScores.map((s, i) => {
    const text = s.sentence ?? ''
    const start = text ? originalText.indexOf(text, cursor) : -1
    const end = start === -1 ? undefined : start + text.length
    if (start !== -1) cursor = end!

    const ai_score = typeof s.score === 'number' ? s.score : null

    return {
      id: `sapling-seg-${i}`,
      text,
      start_char: start === -1 ? undefined : start,
      end_char: end,
      classification: ai_score == null ? undefined : classifyFromScore(ai_score),
      ai_score,
      highlighted_for_ai: ai_score != null && ai_score >= AI_SCORE_THRESHOLD,
      source: 'sapling',
    }
  })
}

// Sapling never reports "mixed" itself — it's derived here, and only when
// the per-sentence data actually shows a genuine split (at least one
// confidently-human sentence and one confidently-ai sentence), rather than
// inferred from the single overall score landing in the middle band (that
// case is 'uncertain': the model is unsure, not evidence of blended content).
function documentClassificationFromScore(score: number, segments: DetectionSegment[]): DetectionClassification {
  const hasHuman = segments.some(s => s.classification === 'human-written')
  const hasAi = segments.some(s => s.classification === 'ai-generated')
  if (hasHuman && hasAi) return 'mixed'
  return classifyFromScore(score)
}

// Deliberately not the shared predictedClassProbability() below: that
// function treats 'uncertain' as a broken-response fallback (GPTZero only
// ever produces it when a classification field is missing/unrecognized) and
// returns null for it. For Sapling, 'uncertain' is a routine, legitimate
// outcome of a genuine near-0.5 score — collapsing it to null would report
// "unknown" confidence for what is actually a confidently low-confidence
// result. Confidence here is "how far the score leans from 0.5", regardless
// of which side of the classification threshold it fell on.
function saplingPredictedClassProbability(score: number, classification: DetectionClassification): number | null {
  switch (classification) {
    case 'human-written': return round(1 - score)
    case 'ai-generated': return round(score)
    case 'uncertain': return round(Math.max(score, 1 - score))
    default: return null // 'mixed' — no single winning class to report a probability for
  }
}

export function normalizeSapling(raw: unknown, originalText: string): DetectionProviderResult {
  if (typeof raw !== 'object' || raw === null) {
    throw new DetectionProviderError('INVALID_PROVIDER_RESPONSE', 'Sapling returned a non-object response.')
  }

  const body = raw as SaplingRawResponse
  const warnings: string[] = []

  const score = typeof body.score === 'number' && !Number.isNaN(body.score) ? body.score : null
  if (score == null) warnings.push('Sapling response did not include a numeric score.')

  const segments = buildSaplingSegments(body.sentence_scores, originalText)
  const classification: DetectionClassification = score == null ? 'uncertain' : documentClassificationFromScore(score, segments)
  const probabilities: ProbabilitySet = score == null
    ? { human: null, ai: null, mixed: null }
    : { human: round(1 - score), ai: round(score), mixed: null }
  const predicted_class_probability = score == null ? null : saplingPredictedClassProbability(score, classification)
  const confidence_category = deriveConfidenceCategory(undefined, predicted_class_probability)
  const estimated_ai_like_fraction = estimateAiLikeFraction(segments)

  return {
    schema_version: '3.0',
    provider: { id: 'sapling' },
    classification,
    probabilities,
    predicted_class_probability,
    confidence_category,
    estimated_ai_like_fraction,
    segments,
    warnings,
    explanation: {
      summary: `Sapling classified this text as ${classification}` +
        (predicted_class_probability != null ? ` (${Math.round(predicted_class_probability * 100)}% confidence).` : '.'),
    },
  }
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

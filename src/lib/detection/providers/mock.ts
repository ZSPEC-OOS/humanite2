import {
  ConfidenceCategory,
  DetectionClassification,
  DetectionProviderError,
  DetectionSegment,
  ProbabilitySet,
} from '../contracts'
import { DetectionProvider, DetectionProviderResult } from './provider'

export type MockFixtureName =
  | 'human'
  | 'ai'
  | 'mixed'
  | 'low-confidence'
  | 'timeout'
  | 'rate-limit'
  | 'invalid-response'

type SegmentClass = 'human-written' | 'ai-generated' | 'uncertain'

// Splits the real input text into sentence-ish segments and cycles the
// given classification pattern across them, so a fixture's segments carry
// char offsets that actually resolve against whatever text was passed in
// — useful for exercising segment highlighting without a live provider.
function splitIntoSegments(text: string, pattern: SegmentClass[]): DetectionSegment[] {
  const sentences = text.match(/[^.!?]+[.!?]*/g)?.map(s => s.trim()).filter(Boolean) ?? [text]
  const segments: DetectionSegment[] = []
  let cursor = 0

  sentences.forEach((sentence, i) => {
    const start = text.indexOf(sentence, cursor)
    if (start === -1) return
    const end = start + sentence.length
    cursor = end

    const classification = pattern[i % pattern.length]!
    const ai_score = classification === 'ai-generated' ? 0.87 : classification === 'uncertain' ? 0.5 : 0.09

    segments.push({
      id: `mock-seg-${i}`,
      text: sentence,
      start_char: start,
      end_char: end,
      classification,
      ai_score,
      highlighted_for_ai: classification === 'ai-generated',
      source: 'mock',
    })
  })

  return segments
}

// Required for development and CI so neither ever spends a real GPTZero
// request. DETECTION_PROVIDER=mock selects this provider; the fixture
// picks which of GPTZero's response shapes (including its failure modes)
// to simulate.
export class MockDetectionProvider implements DetectionProvider {
  readonly id = 'mock'

  constructor(private readonly fixture: MockFixtureName = 'human') {}

  async detect(text: string): Promise<DetectionProviderResult> {
    switch (this.fixture) {
      case 'timeout':
        throw new DetectionProviderError('PROVIDER_TIMEOUT', 'Mock provider timed out.')
      case 'rate-limit':
        throw new DetectionProviderError('PROVIDER_RATE_LIMITED', 'Mock provider rate limit exceeded.')
      case 'invalid-response':
        throw new DetectionProviderError('INVALID_PROVIDER_RESPONSE', 'Mock provider returned a malformed response.')
      case 'human':
        return this.buildResult(text, 'human-written',
          { human: 0.92, ai: 0.05, mixed: 0.03 }, 0.92, 'high', 0.04, ['human-written'])
      case 'ai':
        return this.buildResult(text, 'ai-generated',
          { human: 0.04, ai: 0.93, mixed: 0.03 }, 0.93, 'high', 0.93, ['ai-generated'])
      case 'mixed':
        return this.buildResult(text, 'mixed',
          { human: 0.38, ai: 0.41, mixed: 0.21 }, 0.41, 'medium', 0.55, ['human-written', 'ai-generated'])
      case 'low-confidence':
        // estimated_ai_like_fraction stays null here — a near-even, low
        // confidence split doesn't justify deriving one (spec §13).
        return this.buildResult(text, 'uncertain',
          { human: 0.48, ai: 0.44, mixed: 0.08 }, 0.48, 'low', null, ['uncertain'],
          ['Low-confidence classification — treat with caution.'])
    }
  }

  private buildResult(
    text: string,
    classification: DetectionClassification,
    probabilities: ProbabilitySet,
    predicted_class_probability: number,
    confidence_category: ConfidenceCategory,
    estimated_ai_like_fraction: number | null,
    pattern: SegmentClass[],
    warnings: string[] = [],
  ): DetectionProviderResult {
    return {
      schema_version: '3.0',
      provider: { id: this.id },
      classification,
      probabilities,
      predicted_class_probability,
      confidence_category,
      estimated_ai_like_fraction,
      segments: splitIntoSegments(text, pattern),
      warnings,
      explanation: { summary: `Mock fixture "${this.fixture}" — classified as ${classification}.` },
    }
  }
}

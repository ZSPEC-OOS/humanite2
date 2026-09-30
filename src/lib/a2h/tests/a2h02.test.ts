import { describe, it, expect } from 'vitest'
import { computeA2H02Measurements, aggregateA2H02, computeIntensityTrendDiagnostics } from '../a2h02'
import type { CorpusSource, DetectorResult } from '../types'

const SOURCE: CorpusSource = {
  id: 'source-1',
  corpusProjectId: 'project-1',
  domainId: 'general',
  topicId: 'topic-1',
  targetWords: 100,
  actualWords: 100,
  generatorProvider: 'openai',
  generatorModel: 'gpt-4o-mini',
  generationPrompt: 'p',
  generationPromptVersion: 'GEN-V001',
  temperature: null,
  seed: null,
  text: 'The quick brown fox jumps over the lazy dog near the riverbank every single morning without fail.',
  sha256: 'a'.repeat(64),
  generatedAt: '2026-01-01T00:00:00.000Z',
  frozenAt: '2026-01-01T00:05:00.000Z',
  status: 'frozen',
}

function makePostScore(overrides: Partial<DetectorResult> = {}): DetectorResult {
  return {
    id: 'r1', corpusProjectId: 'project-1', runId: 'run-1', sourceId: 'source-1', outputId: 'output-1',
    detector: 'gptzero', detectorConfigId: 'gptzero-default', stage: 'post_transform',
    aiProbability: 0.2, humanProbability: 0.7, mixedProbability: 0.1, classification: 'human-written',
    analyzedAt: '2026-01-01T00:00:00.000Z', rawResponse: {}, latencyMs: null,
    ...overrides,
  }
}

describe('computeA2H02Measurements', () => {
  it('computes word count delta and percentage change deterministically', () => {
    const output = { outputText: 'A completely different sentence with more words than the original had before.', outputWords: 12, intensity: 5 }
    const measurements = computeA2H02Measurements(SOURCE, output, makePostScore())
    expect(measurements.sourceWords).toBe(100)
    expect(measurements.outputWords).toBe(12)
    expect(measurements.wordCountDelta).toBe(-88)
    expect(measurements.wordCountDeltaPct).toBeCloseTo(-0.88, 10)
    expect(measurements.intensity).toBe(5)
  })

  it('is deterministic for the same source/output pair — no randomness, no LLM judge', () => {
    const output = { outputText: 'A rewritten version of the source text used for this test.', outputWords: 11, intensity: 3 }
    const first = computeA2H02Measurements(SOURCE, output, makePostScore())
    const second = computeA2H02Measurements(SOURCE, output, makePostScore())
    expect(second).toEqual(first)
  })

  it('copies aiProbability/humanProbability/classification straight from the post-score', () => {
    const output = { outputText: 'Some output text.', outputWords: 3, intensity: 7 }
    const postScore = makePostScore({ aiProbability: 0.42, humanProbability: 0.5, classification: 'mixed' })
    const measurements = computeA2H02Measurements(SOURCE, output, postScore)
    expect(measurements.aiProbability).toBe(0.42)
    expect(measurements.humanProbability).toBe(0.5)
    expect(measurements.classification).toBe('mixed')
  })
})

describe('aggregateA2H02', () => {
  it('reports N, transformation magnitude summary, and word count summaries', () => {
    const outputs = [
      { outputText: 'Short one.', outputWords: 2, intensity: 3 },
      { outputText: 'A slightly longer output text here.', outputWords: 6, intensity: 3 },
    ]
    const measurements = outputs.map(o => computeA2H02Measurements(SOURCE, o, makePostScore()))
    const aggregate = aggregateA2H02(measurements)
    expect(aggregate.n).toBe(2)
    expect(aggregate.transformationMagnitude.n).toBe(2)
    expect(aggregate.wordCountAbsChange.n).toBe(2)
  })

  it('computes a post-transform conversion rate (fraction classified human-written) distinct from A2H-01\'s eligibility-gated rate', () => {
    const measurements = [
      computeA2H02Measurements(SOURCE, { outputText: 'a', outputWords: 1, intensity: 1 }, makePostScore({ classification: 'human-written' })),
      computeA2H02Measurements(SOURCE, { outputText: 'b', outputWords: 1, intensity: 1 }, makePostScore({ classification: 'ai-generated' })),
      computeA2H02Measurements(SOURCE, { outputText: 'c', outputWords: 1, intensity: 1 }, makePostScore({ classification: 'human-written' })),
    ]
    const aggregate = aggregateA2H02(measurements)
    expect(aggregate.conversionRate.n).toBe(3)
    expect(aggregate.conversionRate.successRate).toBeCloseTo(2 / 3, 10)
  })

  it('builds a classification distribution across all rows', () => {
    const measurements = [
      computeA2H02Measurements(SOURCE, { outputText: 'a', outputWords: 1, intensity: 1 }, makePostScore({ classification: 'human-written' })),
      computeA2H02Measurements(SOURCE, { outputText: 'b', outputWords: 1, intensity: 1 }, makePostScore({ classification: 'ai-generated' })),
      computeA2H02Measurements(SOURCE, { outputText: 'c', outputWords: 1, intensity: 1 }, makePostScore({ classification: 'human-written' })),
    ]
    const aggregate = aggregateA2H02(measurements)
    expect(aggregate.classificationDistribution).toEqual({ 'human-written': 2, 'ai-generated': 1 })
  })
})

describe('computeIntensityTrendDiagnostics', () => {
  it('returns a strong positive correlation for a monotonically increasing series', () => {
    const byLevel = new Map([[1, 0.1], [2, 0.2], [3, 0.3], [4, 0.4], [5, 0.5], [6, 0.6], [7, 0.7], [8, 0.8], [9, 0.9], [10, 1.0]])
    const diagnostics = computeIntensityTrendDiagnostics(byLevel)
    expect(diagnostics).not.toBeNull()
    expect(diagnostics!.correlation).toBeCloseTo(1, 5)
    expect(diagnostics!.increasingSteps).toBe(9)
    expect(diagnostics!.totalSteps).toBe(9)
  })

  it('band means reflect the low(1-3)/mid(4-7)/high(8-10) split', () => {
    const byLevel = new Map([[1, 0.1], [2, 0.1], [3, 0.1], [4, 0.5], [5, 0.5], [6, 0.5], [7, 0.5], [8, 0.9], [9, 0.9], [10, 0.9]])
    const diagnostics = computeIntensityTrendDiagnostics(byLevel)!
    expect(diagnostics.lowBandMean).toBeCloseTo(0.1, 10)
    expect(diagnostics.midBandMean).toBeCloseTo(0.5, 10)
    expect(diagnostics.highBandMean).toBeCloseTo(0.9, 10)
  })

  it('works generically for a reduced (dry-run) intensity selection', () => {
    const byLevel = new Map([[2, 0.2], [5, 0.5], [8, 0.8]])
    const diagnostics = computeIntensityTrendDiagnostics(byLevel)!
    expect(diagnostics.correlation).toBeCloseTo(1, 5)
    expect(diagnostics.lowBandMean).toBeCloseTo(0.2, 10)
    expect(diagnostics.midBandMean).toBeCloseTo(0.5, 10)
    expect(diagnostics.highBandMean).toBeCloseTo(0.8, 10)
  })

  it('returns null with fewer than 2 levels', () => {
    expect(computeIntensityTrendDiagnostics(new Map([[5, 0.5]]))).toBeNull()
    expect(computeIntensityTrendDiagnostics(new Map())).toBeNull()
  })
})

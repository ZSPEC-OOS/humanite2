import { describe, it, expect } from 'vitest'
import { computeA2H01Measurements, aggregateA2H01 } from '../a2h01'
import type { DetectorResult } from '../types'

function makeResult(overrides: Partial<DetectorResult> = {}): DetectorResult {
  return {
    id: 'r1',
    corpusProjectId: 'project-1',
    runId: 'run-1',
    sourceId: 'source-1',
    outputId: null,
    detector: 'gptzero',
    detectorConfigId: 'gptzero-default',
    stage: 'baseline',
    aiProbability: 0.9,
    humanProbability: 0.05,
    mixedProbability: 0.05,
    classification: 'ai-generated',
    analyzedAt: '2026-01-01T00:00:00.000Z',
    rawResponse: {},
    ...overrides,
  }
}

describe('computeA2H01Measurements', () => {
  it('computes deltaAiProbability as before minus after', () => {
    const baseline = makeResult({ aiProbability: 0.9 })
    const post = makeResult({ stage: 'post_transform', outputId: 'output-1', aiProbability: 0.2, classification: 'human-written' })
    const measurements = computeA2H01Measurements(baseline, post)
    expect(measurements.deltaAiProbability).toBeCloseTo(0.7, 10)
  })

  it('marks eligibleForConversion true only when baseline classification is ai-generated', () => {
    const aiBaseline = makeResult({ classification: 'ai-generated' })
    const humanBaseline = makeResult({ classification: 'human-written' })
    const mixedBaseline = makeResult({ classification: 'mixed' })
    const post = makeResult({ stage: 'post_transform', outputId: 'output-1', classification: 'human-written' })

    expect(computeA2H01Measurements(aiBaseline, post).eligibleForConversion).toBe(true)
    expect(computeA2H01Measurements(humanBaseline, post).eligibleForConversion).toBe(false)
    expect(computeA2H01Measurements(mixedBaseline, post).eligibleForConversion).toBe(false)
  })

  it('convertedAiToHuman is true only when an eligible (baseline-AI) case ends post-transform as human-written', () => {
    const aiBaseline = makeResult({ classification: 'ai-generated' })
    const postHuman = makeResult({ stage: 'post_transform', outputId: 'output-1', classification: 'human-written' })
    const postAi = makeResult({ stage: 'post_transform', outputId: 'output-1', classification: 'ai-generated' })
    const postMixed = makeResult({ stage: 'post_transform', outputId: 'output-1', classification: 'mixed' })

    expect(computeA2H01Measurements(aiBaseline, postHuman).convertedAiToHuman).toBe(true)
    expect(computeA2H01Measurements(aiBaseline, postAi).convertedAiToHuman).toBe(false)
    expect(computeA2H01Measurements(aiBaseline, postMixed).convertedAiToHuman).toBe(false)
  })

  it('convertedAiToHuman is null (not false) for a non-eligible baseline — never silently counted as a failed conversion', () => {
    const humanBaseline = makeResult({ classification: 'human-written' })
    const mixedBaseline = makeResult({ classification: 'mixed' })
    const post = makeResult({ stage: 'post_transform', outputId: 'output-1', classification: 'human-written' })

    expect(computeA2H01Measurements(humanBaseline, post).convertedAiToHuman).toBeNull()
    expect(computeA2H01Measurements(mixedBaseline, post).convertedAiToHuman).toBeNull()
  })

  it('deltaAiProbability is null when either probability is unavailable', () => {
    const baseline = makeResult({ aiProbability: null })
    const post = makeResult({ stage: 'post_transform', outputId: 'output-1', aiProbability: 0.2 })
    expect(computeA2H01Measurements(baseline, post).deltaAiProbability).toBeNull()
  })
})

describe('aggregateA2H01', () => {
  it('excludes baseline-Human and baseline-Mixed sources from the primary conversion denominator', () => {
    const measurements = [
      computeA2H01Measurements(makeResult({ classification: 'ai-generated' }), makeResult({ stage: 'post_transform', classification: 'human-written' })), // eligible, converted
      computeA2H01Measurements(makeResult({ classification: 'ai-generated' }), makeResult({ stage: 'post_transform', classification: 'ai-generated' })), // eligible, not converted
      computeA2H01Measurements(makeResult({ classification: 'human-written' }), makeResult({ stage: 'post_transform', classification: 'human-written' })), // not eligible
      computeA2H01Measurements(makeResult({ classification: 'mixed' }), makeResult({ stage: 'post_transform', classification: 'human-written' })), // not eligible
    ]
    const aggregate = aggregateA2H01(measurements)
    expect(aggregate.n).toBe(4)
    expect(aggregate.nEligible).toBe(2)
    expect(aggregate.nConverted).toBe(1)
    expect(aggregate.conversionRate.n).toBe(2)
    expect(aggregate.conversionRate.successRate).toBe(0.5)
  })

  it('counts a baseline-AI -> post-Human case as a conversion', () => {
    const measurements = [computeA2H01Measurements(makeResult({ classification: 'ai-generated' }), makeResult({ stage: 'post_transform', classification: 'human-written' }))]
    const aggregate = aggregateA2H01(measurements)
    expect(aggregate.nConverted).toBe(1)
    expect(aggregate.conversionRate.successRate).toBe(1)
  })

  it('deltaAiProbability summary includes every row with a non-null delta, not just eligible ones', () => {
    const measurements = [
      computeA2H01Measurements(makeResult({ classification: 'ai-generated', aiProbability: 0.9 }), makeResult({ stage: 'post_transform', aiProbability: 0.1 })), // delta 0.8, eligible
      computeA2H01Measurements(makeResult({ classification: 'human-written', aiProbability: 0.2 }), makeResult({ stage: 'post_transform', aiProbability: 0.1 })), // delta 0.1, not eligible
    ]
    const aggregate = aggregateA2H01(measurements)
    expect(aggregate.deltaAiProbability.n).toBe(2)
    expect(aggregate.deltaAiProbability.mean).toBeCloseTo(0.45, 10)
  })

  it('returns an n=0 conversionRate/deltaAiProbability for an empty input', () => {
    const aggregate = aggregateA2H01([])
    expect(aggregate.n).toBe(0)
    expect(aggregate.nEligible).toBe(0)
    expect(aggregate.conversionRate.successRate).toBeNull()
    expect(aggregate.deltaAiProbability.mean).toBeNull()
  })
})

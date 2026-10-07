import { describe, it, expect } from 'vitest'
import { repeatabilityConditionId, generateA2H07Conditions, aggregateRepeatabilityCondition, estimateRepeatabilityWork } from '../../src/scoring/a2h07'
import type { BenchmarkTrial } from '../../src/shared/types'

function trial(overrides: Partial<BenchmarkTrial> = {}): BenchmarkTrial {
  return {
    id: 't', runId: 'run-1', corpusProjectId: 'proj-1', benchmarkCode: 'A2H-07', sourceId: 'src-1',
    trialIndex: 0, conditionId: 'cond-1', condition: { intensity: 5 }, outputText: 'output', outputSha256: 'hash-a',
    outputWords: 2, modelProvider: 'openai', model: 'gpt-4o-mini', latencyMs: 100, modelCalls: 1, retryCount: 0,
    candidateCount: 1, inputTokens: null, outputTokens: null, estimatedCostUsd: null, aiProbability: 0.2,
    humanProbability: 0.8, classification: 'human-written', diagnostics: { transformationMagnitude: 0.3 },
    status: 'success', errorCode: null, errorMessage: null, createdAt: '', completedAt: '',
    ...overrides,
  }
}

describe('repeatabilityConditionId', () => {
  it('is deterministic for identical inputs', () => {
    const a = repeatabilityConditionId('src-1', 5, 'gpt-4o-mini', 'v1')
    const b = repeatabilityConditionId('src-1', 5, 'gpt-4o-mini', 'v1')
    expect(a).toBe(b)
  })

  it('differs when intensity differs, model differs, or Humanite version differs', () => {
    const base = repeatabilityConditionId('src-1', 5, 'gpt-4o-mini', 'v1')
    expect(repeatabilityConditionId('src-1', 6, 'gpt-4o-mini', 'v1')).not.toBe(base)
    expect(repeatabilityConditionId('src-1', 5, 'gpt-4o', 'v1')).not.toBe(base)
    expect(repeatabilityConditionId('src-1', 5, 'gpt-4o-mini', 'v2')).not.toBe(base)
  })

  it('never includes trialIndex — every repeat of a condition shares one id', () => {
    // conditionId is a pure function of (sourceId, intensity, model, humaniteVersion) —
    // asserted implicitly by its signature not taking trialIndex at all, but
    // verified explicitly here by generating a whole condition set and
    // checking every repeat's conditionId is identical.
    const conditions = generateA2H07Conditions(['src-1'], [5], 3, 'gpt-4o-mini', 'v1')
    expect(new Set(conditions.map(c => c.conditionId)).size).toBe(1)
  })
})

describe('generateA2H07Conditions', () => {
  it('produces sourceCount x intensityCount x repeatCount conditions with distinct trial indices', () => {
    const conditions = generateA2H07Conditions(['src-1', 'src-2'], [3, 6], 5, 'gpt-4o-mini', 'v1')
    expect(conditions).toHaveLength(2 * 2 * 5)
    const forSrc1I3 = conditions.filter(c => c.sourceId === 'src-1' && c.intensity === 3)
    expect(forSrc1I3.map(c => c.trialIndex).sort()).toEqual([0, 1, 2, 3, 4])
  })
})

describe('estimateRepeatabilityWork', () => {
  it('multiplies sources x intensities x repeats for both Humanite and GPTZero call counts', () => {
    const estimate = estimateRepeatabilityWork(90, 3, 5)
    expect(estimate.humaniteTrialOutputs).toBe(1350)
    expect(estimate.gptZeroPostAnalyses).toBe(1350)
  })
})

describe('aggregateRepeatabilityCondition', () => {
  it('computes mean/CV for AI probability and transformation magnitude across repeats', () => {
    const trials = [
      trial({ trialIndex: 0, aiProbability: 0.18, diagnostics: { transformationMagnitude: 0.31 }, outputSha256: 'h1' }),
      trial({ trialIndex: 1, aiProbability: 0.23, diagnostics: { transformationMagnitude: 0.29 }, outputSha256: 'h2' }),
      trial({ trialIndex: 2, aiProbability: 0.16, diagnostics: { transformationMagnitude: 0.33 }, outputSha256: 'h3' }),
    ]
    const agg = aggregateRepeatabilityCondition(trials)
    expect(agg.n).toBe(3)
    expect(agg.aiProbability.mean).toBeCloseTo((0.18 + 0.23 + 0.16) / 3, 5)
    expect(agg.aiProbabilityCv).not.toBeNull()
    expect(agg.transformationMagnitudeCv).not.toBeNull()
  })

  it('reports 100% classification agreement when every repeat agrees', () => {
    const trials = [
      trial({ trialIndex: 0, classification: 'human-written' }),
      trial({ trialIndex: 1, classification: 'human-written' }),
      trial({ trialIndex: 2, classification: 'human-written' }),
    ]
    const agg = aggregateRepeatabilityCondition(trials)
    expect(agg.classificationAgreement).toBe(1)
    expect(agg.aiClassificationAgreement).toBe(1)
  })

  it('reports partial agreement when repeats disagree', () => {
    const trials = [
      trial({ trialIndex: 0, classification: 'human-written' }),
      trial({ trialIndex: 1, classification: 'human-written' }),
      trial({ trialIndex: 2, classification: 'ai-generated' }),
    ]
    const agg = aggregateRepeatabilityCondition(trials)
    expect(agg.classificationAgreement).toBeCloseTo(2 / 3, 5)
  })

  it('counts unique vs identical output hashes correctly', () => {
    const trials = [
      trial({ trialIndex: 0, outputSha256: 'same' }),
      trial({ trialIndex: 1, outputSha256: 'same' }),
      trial({ trialIndex: 2, outputSha256: 'different' }),
    ]
    const agg = aggregateRepeatabilityCondition(trials)
    expect(agg.uniqueOutputCount).toBe(2)
    expect(agg.identicalOutputCount).toBe(1)
  })

  it('excludes failed trials from every statistic', () => {
    const trials = [
      trial({ trialIndex: 0, status: 'success' }),
      trial({ trialIndex: 1, status: 'failed', aiProbability: null, outputSha256: null, classification: null }),
    ]
    const agg = aggregateRepeatabilityCondition(trials)
    expect(agg.n).toBe(1)
  })
})

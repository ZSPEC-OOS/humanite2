import { describe, it, expect } from 'vitest'
import { generateA2H15Conditions, aggregateA2H15, type CandidateSelectionPairMeasurements } from '../a2h15'

function pair(overrides: Partial<CandidateSelectionPairMeasurements> = {}): CandidateSelectionPairMeasurements {
  return {
    sourceId: 'src-1',
    intensity: 5,
    aiProbability: { single: 0.3, production: 0.2, delta: -0.1 },
    transformationMagnitude: { single: 0.3, production: 0.32, delta: 0.02 },
    grammarDamageNewErrorsPer1000: { single: 1, production: 0.5, delta: -0.5 },
    latencyMs: { single: 1000, production: 1800, delta: 800 },
    modelCalls: { single: 1, production: 2, delta: 1 },
    inputTokens: { single: 500, production: 1000, delta: 500 },
    outputTokens: { single: 500, production: 1000, delta: 500 },
    estimatedCostUsd: { single: null, production: null, delta: null },
    preservation: {},
    productionCandidateSelection: { ranCandidateSearch: true, candidateCount: 2, disqualifiedAt: null },
    ...overrides,
  }
}

describe('generateA2H15Conditions', () => {
  it('only generates conditions for intensities that actually invoke candidate search (>= 4)', () => {
    const conditions = generateA2H15Conditions(['src-1'], [1, 3, 4, 5, 8])
    const intensitiesUsed = new Set(conditions.map(c => c.intensity))
    expect(intensitiesUsed.has(1)).toBe(false)
    expect(intensitiesUsed.has(3)).toBe(false)
    expect(intensitiesUsed.has(4)).toBe(true)
    expect(intensitiesUsed.has(5)).toBe(true)
    expect(intensitiesUsed.has(8)).toBe(true)
  })

  it('produces exactly one single arm and one production arm per eligible (source, intensity)', () => {
    const conditions = generateA2H15Conditions(['src-1'], [5])
    expect(conditions).toHaveLength(2)
    expect(conditions.map(c => c.arm).sort()).toEqual(['production', 'single'])
  })
})

describe('aggregateA2H15', () => {
  it('computes candidate rejection rate over candidate-search trials only', () => {
    const pairs = [
      pair({ productionCandidateSelection: { ranCandidateSearch: true, candidateCount: 2, disqualifiedAt: null } }),
      pair({ productionCandidateSelection: { ranCandidateSearch: true, candidateCount: 1, disqualifiedAt: null } }),
    ]
    const agg = aggregateA2H15(pairs)
    // Only the first pair generated more than 1 candidate (so had a genuine rejection).
    expect(agg.candidateRejectionRate).toBe(0.5)
  })

  it('computes the all-candidates-disqualified rate and disqualified-by-stage breakdown', () => {
    const pairs = [
      pair({ productionCandidateSelection: { ranCandidateSearch: true, candidateCount: 2, disqualifiedAt: 'entity_preservation' } }),
      pair({ productionCandidateSelection: { ranCandidateSearch: true, candidateCount: 2, disqualifiedAt: null } }),
    ]
    const agg = aggregateA2H15(pairs)
    expect(agg.allDisqualifiedRate).toBe(0.5)
    expect(agg.disqualifiedByStage['entity_preservation']).toBe(1)
  })

  it('returns null rates (not fabricated zero) when no trial ran candidate search', () => {
    const pairs = [pair({ productionCandidateSelection: { ranCandidateSearch: false, candidateCount: 1, disqualifiedAt: null } })]
    const agg = aggregateA2H15(pairs)
    expect(agg.candidateRejectionRate).toBeNull()
    expect(agg.allDisqualifiedRate).toBeNull()
  })

  it('summarizes deltas across pairs using shared statistics', () => {
    const pairs = [pair(), pair({ aiProbability: { single: 0.4, production: 0.1, delta: -0.3 } })]
    const agg = aggregateA2H15(pairs)
    expect(agg.n).toBe(2)
    expect(agg.aiProbabilityDelta.mean).toBeCloseTo((-0.1 + -0.3) / 2, 5)
  })
})

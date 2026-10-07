import { describe, it, expect } from 'vitest'
import { aggregateA2H03 } from '../../src/scoring/a2h03'
import type { A2H01Row } from '../../src/scoring/a2h01'
import type { A2H02Row } from '../../src/scoring/a2h02'

function a2h01Row(overrides: Partial<A2H01Row> = {}): A2H01Row {
  return {
    sourceId: 's1', outputId: 'o1', domainId: 'general', topicId: 't1', targetWords: 100, intensity: 5, model: 'gpt-4o-mini',
    measurements: {
      aiProbabilityBefore: 0.9, aiProbabilityAfter: 0.1, humanProbabilityBefore: 0.05, humanProbabilityAfter: 0.8,
      mixedProbabilityBefore: 0.05, mixedProbabilityAfter: 0.1, classificationBefore: 'ai-generated', classificationAfter: 'human-written',
      deltaAiProbability: 0.8, eligibleForConversion: true, convertedAiToHuman: true,
      baselineAnalyzedAt: '2026-01-01T00:00:00.000Z', postAnalyzedAt: '2026-01-01T00:10:00.000Z',
      baselineOriginRunId: 'run-1', baselineReusedAcrossRuns: false,
    },
    ...overrides,
  }
}

function a2h02Row(overrides: Partial<A2H02Row> = {}): A2H02Row {
  return {
    sourceId: 's1', outputId: 'o1', domainId: 'general', topicId: 't1', targetWords: 100, intensity: 5,
    appliedIntensity: 5, intensityCapped: false, model: 'gpt-4o-mini',
    measurements: {
      intensity: 5, requestedIntensity: 5, appliedIntensity: 5, intensityCapped: false,
      aiProbability: 0.1, humanProbability: 0.8, classification: 'human-written',
      sourceWords: 100, outputWords: 95, wordCountDelta: -5, wordCountDeltaPct: -0.05, transformationMagnitude: 0.4,
    },
    ...overrides,
  }
}

describe('aggregateA2H03', () => {
  it('takes no client, apiKey, or detector parameter — it can never make a paid call by construction', () => {
    // A type-level guarantee as much as a runtime one: aggregateA2H03's
    // signature only accepts already-computed rows and an optional
    // stratification key, nothing that could reach a network call.
    expect(aggregateA2H03.length).toBeLessThanOrEqual(3)
    expect(() => aggregateA2H03([], [])).not.toThrow()
  })

  it('groups correctly by targetWords', () => {
    const rows01 = [
      a2h01Row({ targetWords: 100, sourceId: 's1' }),
      a2h01Row({ targetWords: 100, sourceId: 's2' }),
      a2h01Row({ targetWords: 500, sourceId: 's3' }),
    ]
    const rows02 = [
      a2h02Row({ targetWords: 100, sourceId: 's1' }),
      a2h02Row({ targetWords: 500, sourceId: 's3' }),
    ]
    const groups = aggregateA2H03(rows01, rows02)
    expect(groups.map(g => g.targetWords)).toEqual([100, 500])
    expect(groups[0]!.n).toBe(2) // 2 A2H-01 rows at 100 words
    expect(groups[1]!.n).toBe(1) // 1 A2H-01 row at 500 words
  })

  it('computes conversionRate and deltaAiProbability per length from A2H-01 rows', () => {
    const base = a2h01Row().measurements
    const rows01 = [
      a2h01Row({ targetWords: 100, sourceId: 's1', measurements: { ...base, convertedAiToHuman: true, eligibleForConversion: true, deltaAiProbability: 0.8 } }),
      a2h01Row({ targetWords: 100, sourceId: 's2', measurements: { ...base, convertedAiToHuman: false, eligibleForConversion: true, deltaAiProbability: 0.2 } }),
    ]
    const groups = aggregateA2H03(rows01, [])
    expect(groups).toHaveLength(1)
    expect(groups[0]!.conversionRate.n).toBe(2)
    expect(groups[0]!.conversionRate.successRate).toBe(0.5)
    expect(groups[0]!.deltaAiProbability.mean).toBeCloseTo(0.5, 10)
  })

  it('computes transformationMagnitude and wordCountAbsChange per length from A2H-02 rows', () => {
    const rows02 = [
      a2h02Row({ targetWords: 200, sourceId: 's1', measurements: { ...a2h02Row().measurements, transformationMagnitude: 0.3, wordCountDelta: -10 } }),
      a2h02Row({ targetWords: 200, sourceId: 's2', measurements: { ...a2h02Row().measurements, transformationMagnitude: 0.5, wordCountDelta: 10 } }),
    ]
    const groups = aggregateA2H03([], rows02)
    expect(groups).toHaveLength(1)
    expect(groups[0]!.transformationMagnitude.mean).toBeCloseTo(0.4, 10)
    expect(groups[0]!.wordCountAbsChange.mean).toBeCloseTo(10, 10)
  })

  it('stratifies by an additional dimension (domain/topic/intensity) when requested', () => {
    const rows01 = [
      a2h01Row({ targetWords: 100, domainId: 'general' }),
      a2h01Row({ targetWords: 100, domainId: 'legal' }),
    ]
    const groups = aggregateA2H03(rows01, [], 'domain')
    expect(groups).toHaveLength(2)
    expect(groups.every(g => g.stratum?.dimension === 'domain')).toBe(true)
    expect(groups.map(g => g.stratum?.value).sort()).toEqual(['general', 'legal'])
  })

  it('returns an empty array for no data', () => {
    expect(aggregateA2H03([], [])).toEqual([])
  })
})

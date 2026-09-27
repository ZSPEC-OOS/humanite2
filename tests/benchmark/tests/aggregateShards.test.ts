import { describe, it, expect } from 'vitest'
import { combineShardReports } from '../aggregateShards'
import type { BenchmarkReport, BenchmarkItemResult } from '../types'

function fakeResult(overrides: Partial<BenchmarkItemResult> = {}): BenchmarkItemResult {
  return {
    id: 'item-1',
    domain: 'general',
    latencyMs: 1000,
    totalTokens: 100,
    estimatedCostUsd: 0.001,
    retryCount: 0,
    entityPreservation: 1,
    semanticSimilarity: 0.9,
    fidelityPassed: true,
    missingFacts: [],
    prohibitedChangesFound: [],
    detectors: [],
    candidateSelection: { chunksWithCandidateSearch: 0, chunksAllDisqualified: 0, disqualifiedByStage: {}, totalCandidatesGenerated: 0 },
    ...overrides,
  }
}

function fakeShard(overrides: Partial<BenchmarkReport>, results: BenchmarkItemResult[]): BenchmarkReport {
  return {
    generatedAt: '2026-01-01T00:00:00.000Z',
    model: 'gpt-4o-mini',
    itemCount: results.length,
    results,
    summary: {
      meanEntityPreservation: null,
      meanSemanticSimilarity: null,
      fidelityPassRate: null,
      retryRate: 0,
      meanLatencyMs: 0,
      totalTokens: 0,
      totalEstimatedCostUsd: 0,
      detectorAiRateAtFixedFpr: {},
      prohibitedChangeViolations: 0,
      candidateDisqualificationRate: null,
      candidateDisqualifiedByStage: {},
    },
    ...overrides,
  }
}

describe('combineShardReports', () => {
  it('concatenates every shard\'s results into one report with the summed item count', () => {
    const shardA = fakeShard({}, [fakeResult({ id: 'general-1' }), fakeResult({ id: 'general-2' })])
    const shardB = fakeShard({}, [fakeResult({ id: 'legal-1', domain: 'legal' })])

    const combined = combineShardReports([shardA, shardB])

    expect(combined.itemCount).toBe(3)
    expect(combined.results.map(r => r.id)).toEqual(['general-1', 'general-2', 'legal-1'])
  })

  it('recomputes the mean across ALL combined items, not an average of each shard\'s own mean', () => {
    // Deliberately uneven shard sizes: a mean-of-means would give shard A's
    // single 0.5 result equal weight to shard B's three 1.0 results (mean
    // of means = 0.75), when the true combined mean across all 4 items is
    // (0.5 + 1 + 1 + 1) / 4 = 0.875.
    const shardA = fakeShard({}, [fakeResult({ id: 'a-1', entityPreservation: 0.5 })])
    const shardB = fakeShard({}, [
      fakeResult({ id: 'b-1', entityPreservation: 1 }),
      fakeResult({ id: 'b-2', entityPreservation: 1 }),
      fakeResult({ id: 'b-3', entityPreservation: 1 }),
    ])

    const combined = combineShardReports([shardA, shardB])

    expect(combined.summary.meanEntityPreservation).toBeCloseTo(0.875, 10)
  })

  it('carries the model from the first shard and the latest of the shards\' own timestamps', () => {
    const shardA = fakeShard({ model: 'gpt-4o-mini', generatedAt: '2026-01-01T00:00:00.000Z' }, [fakeResult({ id: 'a-1' })])
    const shardB = fakeShard({ model: 'gpt-4o-mini', generatedAt: '2026-01-02T00:00:00.000Z' }, [fakeResult({ id: 'b-1' })])

    const combined = combineShardReports([shardA, shardB])

    expect(combined.model).toBe('gpt-4o-mini')
    expect(combined.generatedAt).toBe('2026-01-02T00:00:00.000Z')
  })

  it('stays null for a detector when every shard reports null (today\'s actual state, per an unpopulated reference set)', () => {
    const shardA = fakeShard({ summary: { ...fakeShard({}, []).summary, detectorAiRateAtFixedFpr: { gptzero: null } } }, [fakeResult({ id: 'a-1' })])
    const shardB = fakeShard({ summary: { ...fakeShard({}, []).summary, detectorAiRateAtFixedFpr: { gptzero: null } } }, [fakeResult({ id: 'b-1' })])

    const combined = combineShardReports([shardA, shardB])

    expect(combined.summary.detectorAiRateAtFixedFpr.gptzero).toBeNull()
  })

  it('weights a real per-shard detector rate by that shard\'s item count', () => {
    const shardA = fakeShard(
      { itemCount: 1, summary: { ...fakeShard({}, []).summary, detectorAiRateAtFixedFpr: { gptzero: 0.2 } } },
      [fakeResult({ id: 'a-1' })],
    )
    const shardB = fakeShard(
      { itemCount: 3, summary: { ...fakeShard({}, []).summary, detectorAiRateAtFixedFpr: { gptzero: 0.6 } } },
      [fakeResult({ id: 'b-1' }), fakeResult({ id: 'b-2' }), fakeResult({ id: 'b-3' })],
    )

    const combined = combineShardReports([shardA, shardB])

    // (0.2*1 + 0.6*3) / 4 = 0.5
    expect(combined.summary.detectorAiRateAtFixedFpr.gptzero).toBeCloseTo(0.5, 10)
  })

  it('throws rather than silently producing an empty report when given no shards', () => {
    expect(() => combineShardReports([])).toThrow()
  })
})

import { describe, it, expect } from 'vitest'
import { summarizeOperations, type OperationRecord } from '../a2h17'

function op(overrides: Partial<OperationRecord> = {}): OperationRecord {
  return {
    operation: 'humanite_transform', benchmarkCode: null, domainId: 'general', targetWords: 100, intensity: 5,
    model: 'gpt-4o-mini', latencyMs: 1000, inputTokens: 500, outputTokens: 300, modelCalls: 1, retryCount: 0,
    estimatedCostUsd: null, status: 'success', timedOut: false,
    ...overrides,
  }
}

describe('summarizeOperations — percentile/rate math (§53: integration/grouping, not re-testing percentile itself)', () => {
  it('computes mean/median/p90/p95/p99 latency from synthetic records', () => {
    const latencies = Array.from({ length: 100 }, (_, i) => i + 1) // 1..100
    const records = latencies.map(l => op({ latencyMs: l }))
    const summary = summarizeOperations(records)
    expect(summary.n).toBe(100)
    expect(summary.latencyMs.median).toBeCloseTo(50.5, 1)
    expect(summary.latencyMs.p90).toBeGreaterThan(85)
    expect(summary.latencyMs.p95).toBeGreaterThan(summary.latencyMs.p90!)
    expect(summary.latencyMs.p99).toBeGreaterThan(summary.latencyMs.p95!)
  })

  it('computes retry rate as the fraction of operations with any retry, and total retries', () => {
    const records = [op({ retryCount: 0 }), op({ retryCount: 2 }), op({ retryCount: 0 }), op({ retryCount: 1 })]
    const summary = summarizeOperations(records)
    expect(summary.retries.retryRate).toBe(0.5)
    expect(summary.retries.total).toBe(3)
  })

  it('computes failure rate and timeout rate independently', () => {
    const records = [
      op({ status: 'success', timedOut: false }),
      op({ status: 'failed', timedOut: false }),
      op({ status: 'failed', timedOut: true }),
    ]
    const summary = summarizeOperations(records)
    expect(summary.failures.count).toBe(2)
    expect(summary.failures.rate).toBeCloseTo(2 / 3, 5)
    expect(summary.timeouts.count).toBe(1)
    expect(summary.timeouts.rate).toBeCloseTo(1 / 3, 5)
  })

  it('sums token totals and preserves null-vs-zero distinction (no fabricated zero for unavailable tokens)', () => {
    const records = [op({ inputTokens: 100 }), op({ inputTokens: null }), op({ inputTokens: 200 })]
    const summary = summarizeOperations(records)
    expect(summary.inputTokens.total).toBe(300) // sums only the available values
  })

  it('returns null token stats when NO record reports tokens at all', () => {
    const records = [op({ inputTokens: null }), op({ inputTokens: null })]
    const summary = summarizeOperations(records)
    expect(summary.inputTokens.total).toBeNull()
    expect(summary.inputTokens.mean).toBeNull()
  })

  it('reports cost as null (not zero) when no operation has an estimated cost', () => {
    const summary = summarizeOperations([op(), op()])
    expect(summary.costUsd.total).toBeNull()
  })

  it('handles zero records without throwing, reporting n=0 and null stats', () => {
    const summary = summarizeOperations([])
    expect(summary.n).toBe(0)
    expect(summary.latencyMs.mean).toBeNull()
    expect(summary.failures.rate).toBeNull()
  })
})

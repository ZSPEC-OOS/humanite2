import { describe, it, expect, vi } from 'vitest'
import type OpenAI from 'openai'
import type { DetectionProvider, DetectionProviderResult } from '@/lib/detection/providers/provider'
import type { DetectionClassification } from '@/lib/detection/contracts'
import { runBenchmark } from '../runBenchmark'
import { CORPUS } from '../corpus'

// A minimal, fully-controlled OpenAI-shaped stub — no network calls, no
// real tokens spent. Distinguishes the judge call (its request asks for a
// JSON object) from the generation call so both get a plausible response,
// the same way the existing pipeline unit tests mock a client.
function stubClient(): OpenAI {
  const chatCreate = vi.fn().mockImplementation(async (args: { response_format?: { type?: string } }) => {
    if (args.response_format?.type === 'json_object') {
      return {
        model: 'stub-model',
        choices: [{ message: { content: '{"entailment_probability": 0.9, "issues": []}' }, finish_reason: 'stop' }],
      }
    }
    return {
      model: 'stub-model',
      choices: [{ message: { content: 'A generic rewritten passage, for plumbing purposes only.' }, finish_reason: 'stop' }],
      usage: { total_tokens: 500 },
    }
  })
  const embedCreate = vi.fn().mockResolvedValue({
    data: [{ embedding: [1, 0] }, { embedding: [0.9, 0.1] }],
    usage: { total_tokens: 20 },
  })
  return { chat: { completions: { create: chatCreate } }, embeddings: { create: embedCreate } } as unknown as OpenAI
}

// Two independently-identified stub detectors (MockDetectionProvider always
// reports id 'mock', which would collide here) — proves the "at least two
// detectors" aggregation keys results by provider id correctly.
function stubDetector(id: string, classification: DetectionClassification, aiProbability: number): DetectionProvider {
  return {
    id,
    async detect(): Promise<DetectionProviderResult> {
      return {
        schema_version: '3.0',
        provider: { id },
        classification,
        probabilities: { human: 1 - aiProbability, ai: aiProbability, mixed: 0 },
        predicted_class_probability: aiProbability,
        confidence_category: 'high',
        estimated_ai_like_fraction: aiProbability,
        segments: [],
        warnings: [],
        explanation: null,
      }
    },
  }
}

describe('runBenchmark — end-to-end smoke test (no live provider calls)', () => {
  it('produces a well-formed report over a corpus slice using a stub client and two independently-identified detectors', async () => {
    const items = CORPUS.slice(0, 2)
    const report = await runBenchmark({
      client: stubClient(),
      model: 'stub-model',
      items,
      detectorProviders: [
        stubDetector('detector-a', 'ai-generated', 0.8),
        stubDetector('detector-b', 'human-written', 0.2),
      ],
    })

    expect(report.model).toBe('stub-model')
    expect(report.itemCount).toBe(2)
    expect(report.results).toHaveLength(2)

    for (const result of report.results) {
      expect(result.error).toBeUndefined()
      expect(result.latencyMs).toBeGreaterThanOrEqual(0)
      expect(result.totalTokens).toBeGreaterThan(0)
      expect(result.detectors).toHaveLength(2)
      expect(result.detectors.map(d => d.provider).sort()).toEqual(['detector-a', 'detector-b'])
    }

    expect(report.summary.meanLatencyMs).toBeGreaterThanOrEqual(0)
    expect(report.summary.totalTokens).toBeGreaterThan(0)
    expect(report.summary.totalEstimatedCostUsd).toBeGreaterThan(0)
    // Both detectors are tracked separately, never merged into one figure.
    expect(Object.keys(report.summary.detectorAiRateAtFixedFpr).sort()).toEqual(['detector-a', 'detector-b'])
    // No real human reference passages exist yet (see reference/index.ts) —
    // calibration must report unavailable, never a fabricated rate.
    expect(Object.values(report.summary.detectorAiRateAtFixedFpr).every(v => v === null)).toBe(true)
  })

  it('reports a per-item error rather than throwing when the pipeline itself fails', async () => {
    const failingClient = {
      chat: { completions: { create: vi.fn().mockRejectedValue(new Error('boom')) } },
      embeddings: { create: vi.fn().mockRejectedValue(new Error('boom')) },
    } as unknown as OpenAI

    const report = await runBenchmark({
      client: failingClient,
      model: 'stub-model',
      items: CORPUS.slice(0, 1),
      detectorProviders: [stubDetector('detector-a', 'uncertain', 0.5)],
    })

    expect(report.results).toHaveLength(1)
    expect(report.results[0]!.error).toBeDefined()
    expect(report.results[0]!.fidelityPassed).toBeNull()
    // An errored item must not silently count as scored in the summary.
    expect(report.summary.fidelityPassRate).toBeNull()
  })
})

import { describe, it, expect, vi } from 'vitest'
import type OpenAI from 'openai'
import { runScaleUpSweep, SCALE_UP_INTENSITIES } from '../runBenchmark'
import { CORPUS } from '../corpus'
import { TONES } from '@/lib/style'

// Mirrors runBenchmark.test.ts's own stub client — no network calls, no
// real tokens spent. Proves the sweep's grid-construction logic (one
// runBenchmark pass per tone x intensity cell) without spending real API
// credits; the real, expensive full-corpus run is
// scaleUpSweepAcceptance.test.ts, gated behind RUN_LIVE_BENCHMARK.
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

describe('runScaleUpSweep — grid construction (no live provider calls)', () => {
  it('defaults to the product\'s 5 tones and the plan\'s 3 intensities (2, 5, 8), producing 15 cells', async () => {
    const sweep = await runScaleUpSweep({
      client: stubClient(),
      model: 'stub-model',
      items: CORPUS.slice(0, 1),
      detectorProviders: [],
    })

    expect(sweep.tones).toEqual(TONES)
    expect(sweep.intensities).toEqual(SCALE_UP_INTENSITIES)
    expect(sweep.cells).toHaveLength(TONES.length * SCALE_UP_INTENSITIES.length)
    expect(sweep.cells).toHaveLength(15)
  })

  it('runs every declared cell with its own distinct tone/intensity pair and the same item set', async () => {
    const items = CORPUS.slice(0, 2)
    const sweep = await runScaleUpSweep({
      client: stubClient(),
      model: 'stub-model',
      items,
      tones: ['casual', 'formal'],
      intensities: [2, 8],
      detectorProviders: [],
    })

    expect(sweep.cells).toHaveLength(4)
    const pairs = sweep.cells.map(c => `${c.tone}/${c.intensity}`).sort()
    expect(pairs).toEqual(['casual/2', 'casual/8', 'formal/2', 'formal/8'])
    for (const cell of sweep.cells) {
      expect(cell.report.itemCount).toBe(items.length)
    }
  })

  it('accepts a custom tone/intensity list narrower than the full grid', async () => {
    const sweep = await runScaleUpSweep({
      client: stubClient(),
      model: 'stub-model',
      items: CORPUS.slice(0, 1),
      tones: ['balanced'],
      intensities: [5],
      detectorProviders: [],
    })

    expect(sweep.cells).toHaveLength(1)
    expect(sweep.cells[0]!.tone).toBe('balanced')
    expect(sweep.cells[0]!.intensity).toBe(5)
  })
})

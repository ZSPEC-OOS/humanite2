import { describe, it, expect, vi } from 'vitest'
import type { Firestore } from 'firebase-admin/firestore'
import type OpenAI from 'openai'
import { transformSource, getOutput, listOutputsForSource } from '../outputs'
import type { CorpusSource } from '../types'

function makeFirestore() {
  const docs = new Map<string, Record<string, unknown>>()

  function docRef(id: string) {
    return {
      get: async () => ({ exists: docs.has(id), data: () => docs.get(id) }),
      set: async (data: Record<string, unknown>) => { docs.set(id, data) },
    }
  }

  function makeQuery(predicate: (d: Record<string, unknown>) => boolean) {
    return {
      where: (field: string, _op: string, value: unknown) => makeQuery(d => predicate(d) && d[field] === value),
      get: async () => ({ docs: [...docs.values()].filter(predicate).map(data => ({ data: () => data })) }),
    }
  }

  const collection = { doc: (id: string) => docRef(id), where: (field: string, _op: string, value: unknown) => makeQuery(d => d[field] === value) }
  const firestore = { collection: () => collection }
  return { firestore: firestore as unknown as Firestore, docs }
}

// A minimal, fully-controlled OpenAI-shaped stub — no network calls, no real
// tokens spent. Distinguishes a json_object request (judge/document-context/
// consistency calls) from the plain generation call, the same pattern
// tests/benchmark/tests/runBenchmark.test.ts uses against this same
// pipeline.
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
      choices: [{ message: { content: 'A rewritten passage of the source text, for plumbing purposes only.' }, finish_reason: 'stop' }],
      usage: { total_tokens: 500 },
    }
  })
  return { chat: { completions: { create: chatCreate } } } as unknown as OpenAI
}

function rejectingClient(): OpenAI {
  return {
    chat: { completions: { create: vi.fn().mockRejectedValue(new Error('generation boom')) } },
  } as unknown as OpenAI
}

const FROZEN_SOURCE: CorpusSource = {
  id: 'project-1__topic-1__100',
  corpusProjectId: 'project-1',
  domainId: 'general',
  topicId: 'topic-1',
  targetWords: 100,
  actualWords: 101,
  generatorProvider: 'openai',
  generatorModel: 'gpt-4o-mini',
  generationPrompt: 'prompt text',
  generationPromptVersion: 'GEN-V001',
  temperature: null,
  seed: null,
  text: 'This is a source document with enough words to run through the humanize pipeline safely during a test.',
  sha256: 'a'.repeat(64),
  generatedAt: '2026-01-01T00:00:00.000Z',
  frozenAt: '2026-01-01T00:05:00.000Z',
  status: 'frozen',
}

describe('transformSource', () => {
  it('refuses to transform a source that is not frozen', async () => {
    const { firestore } = makeFirestore()
    const notFrozen: CorpusSource = { ...FROZEN_SOURCE, status: 'validated', frozenAt: null }
    await expect(transformSource(firestore, { source: notFrozen, intensity: 5, client: stubClient(), model: 'stub-model' }))
      .rejects.toThrow(/only a frozen source/i)
  })

  it.each([0, 11, 1.5])('rejects an out-of-range intensity (%s)', async intensity => {
    const { firestore } = makeFirestore()
    await expect(transformSource(firestore, { source: FROZEN_SOURCE, intensity, client: stubClient(), model: 'stub-model' }))
      .rejects.toThrow(/intensity must be/i)
  })

  it('produces a successful output with the transformed text, hash, and timing', async () => {
    const { firestore } = makeFirestore()
    const output = await transformSource(firestore, { source: FROZEN_SOURCE, intensity: 5, client: stubClient(), model: 'stub-model' })

    expect(output.status).toBe('success')
    expect(output.corpusProjectId).toBe(FROZEN_SOURCE.corpusProjectId)
    expect(output.sourceId).toBe(FROZEN_SOURCE.id)
    expect(output.intensity).toBe(5)
    expect(output.outputText.length).toBeGreaterThan(0)
    expect(output.outputSha256).toHaveLength(64)
    expect(output.latencyMs).toBeGreaterThanOrEqual(0)
    expect(output.inputTokens).toBeNull()
    expect(output.estimatedCostUsd).toBeNull()

    const fetched = await getOutput(firestore, FROZEN_SOURCE.id, 5)
    expect(fetched).toEqual(output)
  })

  it('refuses to silently overwrite a successful output without force', async () => {
    const { firestore } = makeFirestore()
    await transformSource(firestore, { source: FROZEN_SOURCE, intensity: 5, client: stubClient(), model: 'stub-model' })
    await expect(transformSource(firestore, { source: FROZEN_SOURCE, intensity: 5, client: stubClient(), model: 'stub-model' }))
      .rejects.toThrow(/already exists/i)
  })

  it('allows overwriting a successful output when force is set', async () => {
    const { firestore } = makeFirestore()
    await transformSource(firestore, { source: FROZEN_SOURCE, intensity: 5, client: stubClient(), model: 'stub-model' })
    const second = await transformSource(firestore, { source: FROZEN_SOURCE, intensity: 5, client: stubClient(), model: 'stub-model' }, true)
    expect(second.status).toBe('success')
  })

  it('persists a failed record and rethrows when the pipeline itself fails', async () => {
    const { firestore } = makeFirestore()
    await expect(transformSource(firestore, { source: FROZEN_SOURCE, intensity: 3, client: rejectingClient(), model: 'stub-model' }))
      .rejects.toThrow(/generation boom/)

    const fetched = await getOutput(firestore, FROZEN_SOURCE.id, 3)
    expect(fetched?.status).toBe('failed')
    expect(fetched?.errorMessage).toMatch(/generation boom/)
  })

  it('allows retrying a failed output without force', async () => {
    const { firestore } = makeFirestore()
    await expect(transformSource(firestore, { source: FROZEN_SOURCE, intensity: 3, client: rejectingClient(), model: 'stub-model' }))
      .rejects.toThrow()
    const retried = await transformSource(firestore, { source: FROZEN_SOURCE, intensity: 3, client: stubClient(), model: 'stub-model' })
    expect(retried.status).toBe('success')
  })
})

describe('listOutputsForSource', () => {
  it('returns every intensity generated for a source, sorted', async () => {
    const { firestore } = makeFirestore()
    await transformSource(firestore, { source: FROZEN_SOURCE, intensity: 8, client: stubClient(), model: 'stub-model' })
    await transformSource(firestore, { source: FROZEN_SOURCE, intensity: 2, client: stubClient(), model: 'stub-model' })

    const outputs = await listOutputsForSource(firestore, FROZEN_SOURCE.id)
    expect(outputs.map(o => o.intensity)).toEqual([2, 8])
  })
})

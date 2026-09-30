import { describe, it, expect, vi } from 'vitest'
import type { Firestore } from 'firebase-admin/firestore'
import type OpenAI from 'openai'
import { transformSource, getOutput, getOutputById, listOutputsForSource, listOutputsForRun } from '../outputs'
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

// Same stub, but WITH prompt_tokens/completion_tokens on every completion —
// isolates "does transformSource actually propagate real token usage" from
// "does this particular stub happen to report it" (see stubClient above,
// which deliberately omits them to prove the null-vs-zero distinction too).
function stubClientWithTokenUsage(): OpenAI {
  const chatCreate = vi.fn().mockImplementation(async (args: { response_format?: { type?: string } }) => {
    if (args.response_format?.type === 'json_object') {
      return {
        model: 'stub-model',
        choices: [{ message: { content: '{"entailment_probability": 0.9, "issues": []}' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 120, completion_tokens: 40, total_tokens: 160 },
      }
    }
    return {
      model: 'stub-model',
      choices: [{ message: { content: 'A rewritten passage of the source text, for plumbing purposes only.' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 300, completion_tokens: 200, total_tokens: 500 },
    }
  })
  return { chat: { completions: { create: chatCreate } } } as unknown as OpenAI
}

function rejectingClient(): OpenAI {
  return {
    chat: { completions: { create: vi.fn().mockRejectedValue(new Error('generation boom')) } },
  } as unknown as OpenAI
}

const RUN_ID = 'run-1'

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
    await expect(transformSource(firestore, { runId: RUN_ID, source: notFrozen, intensity: 5, client: stubClient(), model: 'stub-model', modelProvider: 'openai' }))
      .rejects.toThrow(/only a frozen source/i)
  })

  it.each([0, 11, 1.5])('rejects an out-of-range intensity (%s)', async intensity => {
    const { firestore } = makeFirestore()
    await expect(transformSource(firestore, { runId: RUN_ID, source: FROZEN_SOURCE, intensity, client: stubClient(), model: 'stub-model', modelProvider: 'openai' }))
      .rejects.toThrow(/intensity must be/i)
  })

  it('produces a successful output with the transformed text, hash, and timing', async () => {
    const { firestore } = makeFirestore()
    const output = await transformSource(firestore, { runId: RUN_ID, source: FROZEN_SOURCE, intensity: 5, client: stubClient(), model: 'stub-model', modelProvider: 'openai' })

    expect(output.status).toBe('success')
    expect(output.runId).toBe(RUN_ID)
    expect(output.corpusProjectId).toBe(FROZEN_SOURCE.corpusProjectId)
    expect(output.sourceId).toBe(FROZEN_SOURCE.id)
    expect(output.intensity).toBe(5)
    expect(output.outputText.length).toBeGreaterThan(0)
    expect(output.outputSha256).toHaveLength(64)
    expect(output.latencyMs).toBeGreaterThanOrEqual(0)
    // Phase 5: modelCalls is now real telemetry from humanizeChunk (a
    // positive count of primary generation completions) — inputTokens/
    // outputTokens stay null here only because this particular stub client
    // never sets completion.usage.prompt_tokens/completion_tokens, not
    // because the plumbing itself is missing (see a2h/tests/execution.test.ts
    // for a stub that does set them).
    expect(output.modelCalls).toBeGreaterThan(0)
    expect(output.inputTokens).toBeNull()
    expect(output.estimatedCostUsd).toBeNull()

    const fetched = await getOutput(firestore, RUN_ID, FROZEN_SOURCE.id, 5)
    expect(fetched).toEqual(output)
    expect(await getOutputById(firestore, output.id)).toEqual(output)
  })

  it('propagates real inputTokens/outputTokens when the provider reports usage (Phase 5 telemetry)', async () => {
    const { firestore } = makeFirestore()
    const output = await transformSource(firestore, { runId: RUN_ID, source: FROZEN_SOURCE, intensity: 5, client: stubClientWithTokenUsage(), model: 'stub-model', modelProvider: 'openai' })
    expect(output.modelCalls).toBeGreaterThan(0)
    expect(output.inputTokens).toBeGreaterThan(0)
    expect(output.outputTokens).toBeGreaterThan(0)
  })

  it('refuses to regenerate an output on a released run, even with forceOverwrite', async () => {
    const { firestore } = makeFirestore()
    await transformSource(firestore, { runId: RUN_ID, source: FROZEN_SOURCE, intensity: 5, client: stubClient(), model: 'stub-model', modelProvider: 'openai' })
    await expect(transformSource(
      firestore,
      { runId: RUN_ID, source: FROZEN_SOURCE, intensity: 5, client: stubClient(), model: 'stub-model', modelProvider: 'openai', releasedAt: '2026-01-01T00:00:00.000Z' },
      true,
    )).rejects.toThrow(/released/i)
  })

  it('reuses an existing successful output without calling the model again (idempotent resume, §26)', async () => {
    const { firestore } = makeFirestore()
    const client = stubClient()
    const first = await transformSource(firestore, { runId: RUN_ID, source: FROZEN_SOURCE, intensity: 5, client, model: 'stub-model', modelProvider: 'openai' })
    const callsAfterFirst = (client.chat.completions.create as ReturnType<typeof vi.fn>).mock.calls.length
    const second = await transformSource(firestore, { runId: RUN_ID, source: FROZEN_SOURCE, intensity: 5, client, model: 'stub-model', modelProvider: 'openai' })
    expect(second).toEqual(first)
    expect((client.chat.completions.create as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsAfterFirst)
  })

  it('never mixes outputs across two different runs for the same source/intensity', async () => {
    const { firestore } = makeFirestore()
    const outputA = await transformSource(firestore, { runId: 'run-a', source: FROZEN_SOURCE, intensity: 5, client: stubClient(), model: 'stub-model', modelProvider: 'openai' })
    const outputB = await transformSource(firestore, { runId: 'run-b', source: FROZEN_SOURCE, intensity: 5, client: stubClient(), model: 'stub-model', modelProvider: 'openai' })
    expect(outputA.id).not.toBe(outputB.id)
    expect(await getOutput(firestore, 'run-a', FROZEN_SOURCE.id, 5)).toEqual(outputA)
    expect(await getOutput(firestore, 'run-b', FROZEN_SOURCE.id, 5)).toEqual(outputB)
  })

  it('allows overwriting a successful output when force is set', async () => {
    const { firestore } = makeFirestore()
    await transformSource(firestore, { runId: RUN_ID, source: FROZEN_SOURCE, intensity: 5, client: stubClient(), model: 'stub-model', modelProvider: 'openai' })
    const second = await transformSource(firestore, { runId: RUN_ID, source: FROZEN_SOURCE, intensity: 5, client: stubClient(), model: 'stub-model', modelProvider: 'openai' }, true)
    expect(second.status).toBe('success')
  })

  it('persists a failed record and rethrows when the pipeline itself fails', async () => {
    const { firestore } = makeFirestore()
    await expect(transformSource(firestore, { runId: RUN_ID, source: FROZEN_SOURCE, intensity: 3, client: rejectingClient(), model: 'stub-model', modelProvider: 'openai' }))
      .rejects.toThrow(/generation boom/)

    const fetched = await getOutput(firestore, RUN_ID, FROZEN_SOURCE.id, 3)
    expect(fetched?.status).toBe('failed')
    expect(fetched?.errorCode).toBeTruthy()
    expect(fetched?.errorMessage).toMatch(/generation boom/)
  })

  it('allows retrying a failed output without force', async () => {
    const { firestore } = makeFirestore()
    await expect(transformSource(firestore, { runId: RUN_ID, source: FROZEN_SOURCE, intensity: 3, client: rejectingClient(), model: 'stub-model', modelProvider: 'openai' }))
      .rejects.toThrow()
    const retried = await transformSource(firestore, { runId: RUN_ID, source: FROZEN_SOURCE, intensity: 3, client: stubClient(), model: 'stub-model', modelProvider: 'openai' })
    expect(retried.status).toBe('success')
  })
})

describe('listOutputsForSource / listOutputsForRun', () => {
  it('returns every intensity generated for a source, sorted', async () => {
    const { firestore } = makeFirestore()
    await transformSource(firestore, { runId: RUN_ID, source: FROZEN_SOURCE, intensity: 8, client: stubClient(), model: 'stub-model', modelProvider: 'openai' })
    await transformSource(firestore, { runId: RUN_ID, source: FROZEN_SOURCE, intensity: 2, client: stubClient(), model: 'stub-model', modelProvider: 'openai' })

    const outputs = await listOutputsForSource(firestore, RUN_ID, FROZEN_SOURCE.id)
    expect(outputs.map(o => o.intensity)).toEqual([2, 8])
  })

  it('listOutputsForRun returns every output for a run regardless of source', async () => {
    const { firestore } = makeFirestore()
    const otherSource: CorpusSource = { ...FROZEN_SOURCE, id: 'project-1__topic-2__100', topicId: 'topic-2' }
    await transformSource(firestore, { runId: RUN_ID, source: FROZEN_SOURCE, intensity: 1, client: stubClient(), model: 'stub-model', modelProvider: 'openai' })
    await transformSource(firestore, { runId: RUN_ID, source: otherSource, intensity: 1, client: stubClient(), model: 'stub-model', modelProvider: 'openai' })
    await transformSource(firestore, { runId: 'run-other', source: FROZEN_SOURCE, intensity: 1, client: stubClient(), model: 'stub-model', modelProvider: 'openai' })

    const outputs = await listOutputsForRun(firestore, RUN_ID)
    expect(outputs).toHaveLength(2)
    expect(outputs.every(o => o.runId === RUN_ID)).toBe(true)
  })
})

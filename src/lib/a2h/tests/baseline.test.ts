import { describe, it, expect, vi, afterEach } from 'vitest'
import type { Firestore } from 'firebase-admin/firestore'
import { acquireBaseline, getBaseline, listBaselinesForSources, acquirePostScore, getPostScore, listPostScoresForOutputs } from '../baseline'
import type { CorpusSource, BenchmarkOutput } from '../types'

function makeFirestore() {
  const docs = new Map<string, Record<string, unknown>>()

  function docRef(id: string) {
    return {
      get: async () => ({ exists: docs.has(id), data: () => docs.get(id) }),
      set: async (data: Record<string, unknown>) => { docs.set(id, data) },
    }
  }

  const collection = { doc: (id: string) => docRef(id) }
  const firestore = { collection: () => collection }
  return { firestore: firestore as unknown as Firestore, docs }
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const DETECTOR_CONFIG = 'gptzero-default'

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
  text: 'Some frozen source text.',
  sha256: 'a'.repeat(64),
  generatedAt: '2026-01-01T00:00:00.000Z',
  frozenAt: '2026-01-01T00:05:00.000Z',
  status: 'frozen',
}

describe('acquireBaseline', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('refuses to acquire a baseline for a source that is not frozen', async () => {
    const { firestore } = makeFirestore()
    const notFrozen: CorpusSource = { ...FROZEN_SOURCE, status: 'validated', frozenAt: null }
    await expect(acquireBaseline(firestore, { source: notFrozen, runId: 'run-1', detectorConfigId: DETECTOR_CONFIG, apiKey: 'test-key' }))
      .rejects.toThrow(/only a frozen source/i)
  })

  it('acquires and persists a baseline for a frozen source, retaining the raw response', async () => {
    const rawBody = { classification: 'ai', class_probabilities: { human: 0.1, ai: 0.85, mixed: 0.05 } }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, rawBody)))

    const { firestore } = makeFirestore()
    const baseline = await acquireBaseline(firestore, { source: FROZEN_SOURCE, runId: 'run-1', detectorConfigId: DETECTOR_CONFIG, apiKey: 'test-key' })

    expect(baseline.sourceId).toBe(FROZEN_SOURCE.id)
    expect(baseline.corpusProjectId).toBe(FROZEN_SOURCE.corpusProjectId)
    expect(baseline.runId).toBe('run-1')
    expect(baseline.detectorConfigId).toBe(DETECTOR_CONFIG)
    expect(baseline.stage).toBe('baseline')
    expect(baseline.detector).toBe('gptzero')
    expect(baseline.classification).toBe('ai-generated')
    expect(baseline.aiProbability).toBe(0.85)
    expect(baseline.humanProbability).toBe(0.1)
    expect(baseline.rawResponse).toEqual(rawBody)

    const fetched = await getBaseline(firestore, FROZEN_SOURCE.id, DETECTOR_CONFIG)
    expect(fetched).toEqual(baseline)
  })

  it('reuses an existing baseline without calling GPTZero again — the cross-run dedup §8 requires', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { classification: 'ai', class_probabilities: { human: 0.1, ai: 0.9, mixed: 0 } }))
    vi.stubGlobal('fetch', fetchMock)
    const { firestore } = makeFirestore()

    const first = await acquireBaseline(firestore, { source: FROZEN_SOURCE, runId: 'run-1', detectorConfigId: DETECTOR_CONFIG, apiKey: 'test-key' })
    const second = await acquireBaseline(firestore, { source: FROZEN_SOURCE, runId: 'run-1', detectorConfigId: DETECTOR_CONFIG, apiKey: 'test-key' })

    expect(second).toEqual(first)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reuses the same baseline across a DIFFERENT run — the exact same source + detector configuration is never paid for twice', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { classification: 'ai', class_probabilities: { human: 0.1, ai: 0.9, mixed: 0 } }))
    vi.stubGlobal('fetch', fetchMock)
    const { firestore } = makeFirestore()

    const runA = await acquireBaseline(firestore, { source: FROZEN_SOURCE, runId: 'run-a', detectorConfigId: DETECTOR_CONFIG, apiKey: 'test-key' })
    const runB = await acquireBaseline(firestore, { source: FROZEN_SOURCE, runId: 'run-b', detectorConfigId: DETECTOR_CONFIG, apiKey: 'test-key' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    // runId on the stored record still reflects whichever run created it
    // first — provenance only, never part of the lookup/reuse key.
    expect(runB.runId).toBe('run-a')
    expect(runB).toEqual(runA)
  })

  it('allows re-acquiring an existing baseline when force is set', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { classification: 'ai', class_probabilities: { human: 0.1, ai: 0.9, mixed: 0 } }))
      .mockResolvedValueOnce(jsonResponse(200, { classification: 'human', class_probabilities: { human: 0.95, ai: 0.05, mixed: 0 } }))
    vi.stubGlobal('fetch', fetchMock)

    const { firestore } = makeFirestore()
    await acquireBaseline(firestore, { source: FROZEN_SOURCE, runId: 'run-1', detectorConfigId: DETECTOR_CONFIG, apiKey: 'test-key' })
    const reacquired = await acquireBaseline(firestore, { source: FROZEN_SOURCE, runId: 'run-1', detectorConfigId: DETECTOR_CONFIG, apiKey: 'test-key' }, true)
    expect(reacquired.classification).toBe('human-written')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('propagates a detector provider error rather than persisting a partial result', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(401, {})))
    const { firestore } = makeFirestore()
    await expect(acquireBaseline(firestore, { source: FROZEN_SOURCE, runId: 'run-1', detectorConfigId: DETECTOR_CONFIG, apiKey: 'test-key' }))
      .rejects.toMatchObject({ code: 'PROVIDER_UNAUTHORIZED' })
    expect(await getBaseline(firestore, FROZEN_SOURCE.id, DETECTOR_CONFIG)).toBeNull()
  })
})

describe('listBaselinesForSources', () => {
  it('returns a map keyed by sourceId, omitting ids with no stored baseline', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { classification: 'human' })))
    const { firestore } = makeFirestore()
    await acquireBaseline(firestore, { source: FROZEN_SOURCE, runId: 'run-1', detectorConfigId: DETECTOR_CONFIG, apiKey: 'test-key' })
    vi.unstubAllGlobals()

    const map = await listBaselinesForSources(firestore, [FROZEN_SOURCE.id, 'no-such-source'], DETECTOR_CONFIG)
    expect(Object.keys(map)).toEqual([FROZEN_SOURCE.id])
  })
})

const SUCCESSFUL_OUTPUT: BenchmarkOutput = {
  id: `run-1__${FROZEN_SOURCE.id}__5`,
  runId: 'run-1',
  corpusProjectId: FROZEN_SOURCE.corpusProjectId,
  sourceId: FROZEN_SOURCE.id,
  domainId: 'general',
  topicId: 'topic-1',
  targetWords: 100,
  intensity: 5,
  outputText: 'The transformed output text.',
  outputWords: 5,
  outputSha256: 'b'.repeat(64),
  modelProvider: 'openai',
  model: 'stub-model',
  retryCount: 0,
  candidateCount: 1,
  modelCalls: null,
  latencyMs: 120,
  inputTokens: null,
  outputTokens: null,
  estimatedCostUsd: null,
  generatedAt: '2026-01-01T00:10:00.000Z',
  status: 'success',
  errorCode: null,
  errorMessage: null,
}

describe('acquirePostScore', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('refuses to score a failed output', async () => {
    const { firestore } = makeFirestore()
    const failed: BenchmarkOutput = { ...SUCCESSFUL_OUTPUT, status: 'failed', errorMessage: 'boom' }
    await expect(acquirePostScore(firestore, { output: failed, detectorConfigId: DETECTOR_CONFIG, apiKey: 'test-key' })).rejects.toThrow(/failed transformation/i)
  })

  it('acquires and persists a post-score keyed to the output, distinct from the source baseline', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { classification: 'human', class_probabilities: { human: 0.9, ai: 0.1, mixed: 0 } })))
    const { firestore } = makeFirestore()

    const postScore = await acquirePostScore(firestore, { output: SUCCESSFUL_OUTPUT, detectorConfigId: DETECTOR_CONFIG, apiKey: 'test-key' })
    expect(postScore.outputId).toBe(SUCCESSFUL_OUTPUT.id)
    expect(postScore.sourceId).toBe(FROZEN_SOURCE.id)
    expect(postScore.runId).toBe(SUCCESSFUL_OUTPUT.runId)
    expect(postScore.corpusProjectId).toBe(FROZEN_SOURCE.corpusProjectId)
    expect(postScore.stage).toBe('post_transform')
    expect(postScore.classification).toBe('human-written')

    const fetched = await getPostScore(firestore, SUCCESSFUL_OUTPUT.id, DETECTOR_CONFIG)
    expect(fetched).toEqual(postScore)
    // A baseline (keyed by sourceId alone) and a post-score (keyed by
    // outputId) must never collide in storage.
    expect(await getBaseline(firestore, FROZEN_SOURCE.id, DETECTOR_CONFIG)).toBeNull()
  })

  it('reuses an existing post-score without calling GPTZero again (idempotent resume)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { classification: 'human' }))
    vi.stubGlobal('fetch', fetchMock)
    const { firestore } = makeFirestore()
    const first = await acquirePostScore(firestore, { output: SUCCESSFUL_OUTPUT, detectorConfigId: DETECTOR_CONFIG, apiKey: 'test-key' })
    const second = await acquirePostScore(firestore, { output: SUCCESSFUL_OUTPUT, detectorConfigId: DETECTOR_CONFIG, apiKey: 'test-key' })
    expect(second).toEqual(first)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('allows re-scoring when force is set', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { classification: 'human' }))
      .mockResolvedValueOnce(jsonResponse(200, { classification: 'ai' }))
    vi.stubGlobal('fetch', fetchMock)
    const { firestore } = makeFirestore()
    await acquirePostScore(firestore, { output: SUCCESSFUL_OUTPUT, detectorConfigId: DETECTOR_CONFIG, apiKey: 'test-key' })
    const reacquired = await acquirePostScore(firestore, { output: SUCCESSFUL_OUTPUT, detectorConfigId: DETECTOR_CONFIG, apiKey: 'test-key' }, true)
    expect(reacquired.classification).toBe('ai-generated')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('listPostScoresForOutputs', () => {
  it('returns a map keyed by outputId', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { classification: 'human' })))
    const { firestore } = makeFirestore()
    await acquirePostScore(firestore, { output: SUCCESSFUL_OUTPUT, detectorConfigId: DETECTOR_CONFIG, apiKey: 'test-key' })

    const map = await listPostScoresForOutputs(firestore, [SUCCESSFUL_OUTPUT.id, 'no-such-output'], DETECTOR_CONFIG)
    expect(Object.keys(map)).toEqual([SUCCESSFUL_OUTPUT.id])
  })
})

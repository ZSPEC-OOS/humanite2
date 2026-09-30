import { describe, it, expect, vi, afterEach } from 'vitest'
import type { Firestore } from 'firebase-admin/firestore'
import { acquireBaseline, getBaseline, listBaselines, acquirePostScore, getPostScore, listPostScores } from '../baseline'
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
    await expect(acquireBaseline(firestore, notFrozen, 'test-key')).rejects.toThrow(/only a frozen source/i)
  })

  it('acquires and persists a baseline for a frozen source, retaining the raw response', async () => {
    const rawBody = { classification: 'ai', class_probabilities: { human: 0.1, ai: 0.85, mixed: 0.05 } }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, rawBody)))

    const { firestore } = makeFirestore()
    const baseline = await acquireBaseline(firestore, FROZEN_SOURCE, 'test-key')

    expect(baseline.sourceId).toBe(FROZEN_SOURCE.id)
    expect(baseline.corpusProjectId).toBe(FROZEN_SOURCE.corpusProjectId)
    expect(baseline.detector).toBe('gptzero')
    expect(baseline.classification).toBe('ai-generated')
    expect(baseline.aiProbability).toBe(0.85)
    expect(baseline.humanProbability).toBe(0.1)
    expect(baseline.rawResponse).toEqual(rawBody)

    const fetched = await getBaseline(firestore, FROZEN_SOURCE.id)
    expect(fetched).toEqual(baseline)
  })

  it('refuses to silently re-acquire an existing baseline without force', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { classification: 'ai' })))
    const { firestore } = makeFirestore()
    await acquireBaseline(firestore, FROZEN_SOURCE, 'test-key')

    await expect(acquireBaseline(firestore, FROZEN_SOURCE, 'test-key')).rejects.toThrow(/already exists/i)
  })

  it('allows re-acquiring an existing baseline when force is set', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { classification: 'ai', class_probabilities: { human: 0.1, ai: 0.9, mixed: 0 } }))
      .mockResolvedValueOnce(jsonResponse(200, { classification: 'human', class_probabilities: { human: 0.95, ai: 0.05, mixed: 0 } }))
    vi.stubGlobal('fetch', fetchMock)

    const { firestore } = makeFirestore()
    await acquireBaseline(firestore, FROZEN_SOURCE, 'test-key')
    const reacquired = await acquireBaseline(firestore, FROZEN_SOURCE, 'test-key', true)
    expect(reacquired.classification).toBe('human-written')
  })

  it('propagates a detector provider error rather than persisting a partial result', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(401, {})))
    const { firestore } = makeFirestore()
    await expect(acquireBaseline(firestore, FROZEN_SOURCE, 'test-key')).rejects.toMatchObject({ code: 'PROVIDER_UNAUTHORIZED' })
    expect(await getBaseline(firestore, FROZEN_SOURCE.id)).toBeNull()
  })
})

describe('listBaselines', () => {
  it('returns a map keyed by sourceId, omitting ids with no stored baseline', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { classification: 'human' })))
    const { firestore } = makeFirestore()
    await acquireBaseline(firestore, FROZEN_SOURCE, 'test-key')
    vi.unstubAllGlobals()

    const map = await listBaselines(firestore, [FROZEN_SOURCE.id, 'no-such-source'])
    expect(Object.keys(map)).toEqual([FROZEN_SOURCE.id])
  })
})

const SUCCESSFUL_OUTPUT: BenchmarkOutput = {
  id: `${FROZEN_SOURCE.id}__I5`,
  corpusProjectId: FROZEN_SOURCE.corpusProjectId,
  sourceId: FROZEN_SOURCE.id,
  domainId: 'general',
  topicId: 'topic-1',
  targetWords: 100,
  intensity: 5,
  outputText: 'The transformed output text.',
  outputWords: 5,
  outputSha256: 'b'.repeat(64),
  modelUsed: 'stub-model',
  retryCount: 0,
  candidateCount: 1,
  latencyMs: 120,
  inputTokens: null,
  outputTokens: null,
  estimatedCostUsd: null,
  generatedAt: '2026-01-01T00:10:00.000Z',
  status: 'success',
  errorMessage: null,
}

describe('acquirePostScore', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('refuses to score a failed output', async () => {
    const { firestore } = makeFirestore()
    const failed: BenchmarkOutput = { ...SUCCESSFUL_OUTPUT, status: 'failed', errorMessage: 'boom' }
    await expect(acquirePostScore(firestore, failed, 'test-key')).rejects.toThrow(/failed transformation/i)
  })

  it('acquires and persists a post-score keyed to the output, distinct from the source baseline', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { classification: 'human', class_probabilities: { human: 0.9, ai: 0.1, mixed: 0 } })))
    const { firestore } = makeFirestore()

    const postScore = await acquirePostScore(firestore, SUCCESSFUL_OUTPUT, 'test-key')
    expect(postScore.outputId).toBe(SUCCESSFUL_OUTPUT.id)
    expect(postScore.sourceId).toBe(FROZEN_SOURCE.id)
    expect(postScore.corpusProjectId).toBe(FROZEN_SOURCE.corpusProjectId)
    expect(postScore.classification).toBe('human-written')

    const fetched = await getPostScore(firestore, SUCCESSFUL_OUTPUT.id)
    expect(fetched).toEqual(postScore)
    // A baseline (keyed by sourceId alone) and a post-score (keyed by
    // outputId) must never collide in storage.
    expect(await getBaseline(firestore, FROZEN_SOURCE.id)).toBeNull()
  })

  it('refuses to silently re-acquire an existing post-score without force', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { classification: 'human' })))
    const { firestore } = makeFirestore()
    await acquirePostScore(firestore, SUCCESSFUL_OUTPUT, 'test-key')
    await expect(acquirePostScore(firestore, SUCCESSFUL_OUTPUT, 'test-key')).rejects.toThrow(/already exists/i)
  })
})

describe('listPostScores', () => {
  it('returns a map keyed by outputId', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { classification: 'human' })))
    const { firestore } = makeFirestore()
    await acquirePostScore(firestore, SUCCESSFUL_OUTPUT, 'test-key')

    const map = await listPostScores(firestore, [SUCCESSFUL_OUTPUT.id, 'no-such-output'])
    expect(Object.keys(map)).toEqual([SUCCESSFUL_OUTPUT.id])
  })
})

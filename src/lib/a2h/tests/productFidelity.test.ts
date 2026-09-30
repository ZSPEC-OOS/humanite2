import { describe, it, expect, vi, afterEach } from 'vitest'
import type { Firestore } from 'firebase-admin/firestore'
import type OpenAI from 'openai'
import { runA2H07Trial } from '../a2h07'
import { runA2H11Trial, INITIAL_STYLE_TONE_CONTRASTS } from '../a2h11'
import { runA2H14Trial, INITIAL_GENRE_AUDIENCE_CONTRASTS } from '../a2h14'
import { runA2H15Trial } from '../a2h15'
import { getTrial, trialId } from '../trials'
import type { BenchmarkRun, BenchmarkJob, CorpusSource } from '../types'

// "Final Polish" patch, §23: proves each experimental-trial runner
// (A2H-07/11/14/15) records the SAME requested-vs-applied domain-intensity
// decision production's own effectiveIntensity() policy would make — never
// the raw requested value — on the persisted BenchmarkTrial's `condition`,
// exactly the scenarios the patch names.

// Non-transactional fake — sufficient here since getOrCreateTrial only ever
// calls ref.get()/ref.set(), never runTransaction (same fake shape as
// outputs.test.ts uses for transformSource).
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
  return { firestore: firestore as unknown as Firestore }
}

function stubClient(): OpenAI {
  const create = vi.fn().mockImplementation(async (args: { model: string; response_format?: { type?: string } }) => {
    if (args.response_format?.type === 'json_object') {
      return { model: args.model, choices: [{ message: { content: '{"entailment_probability": 0.9, "issues": []}' }, finish_reason: 'stop' }] }
    }
    return {
      model: args.model,
      choices: [{ message: { content: 'A humanized rewrite of the source text, produced for regression-test purposes only.' }, finish_reason: 'stop' }],
      usage: { total_tokens: 400 },
    }
  })
  return { chat: { completions: { create } } } as unknown as OpenAI
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function makeSource(overrides: Partial<CorpusSource> = {}): CorpusSource {
  return {
    id: 'src-1', corpusProjectId: 'proj-1', domainId: 'general', topicId: 'topic-1', targetWords: 100, actualWords: 100,
    generatorProvider: 'openai', generatorModel: 'gpt-4o-mini', generationPrompt: 'p', generationPromptVersion: 'GEN-V001',
    temperature: null, seed: null,
    text: 'A patient should consult their physician before beginning any new treatment regimen for this condition.',
    sha256: 'a'.repeat(64), generatedAt: '2026-01-01T00:00:00.000Z', frozenAt: '2026-01-01T00:05:00.000Z', status: 'frozen',
    ...overrides,
  }
}

function makeRun(overrides: Partial<BenchmarkRun> = {}): BenchmarkRun {
  return {
    id: 'run-1', corpusProjectId: 'proj-1', name: 'Test Run', benchmarkVersion: 'v1', testVersion: 'v1',
    corpusManifestHash: 'hash', humaniteVersion: 'humanite-v1', gitCommit: 'abc123', modelProvider: 'openai',
    model: 'gpt-4o-mini', detectorConfigId: null, selectedDomains: ['general'], selectedTopicIds: [], selectedLengths: [100],
    intensities: [5], enabledTests: [], fixtureSetId: null, fixtureVersion: null, repairConfigVersion: 'REPAIR-V001',
    grammarEngineConfigVersion: 'GRAMMAR-V001', experimentConfig: null, concurrency: 1, status: 'running',
    createdAt: '', updatedAt: '', validatedAt: null, startedAt: null, completedAt: null, releasedAt: null,
    executionSemanticsVersion: 'A2H-EXEC-V002',
    ...overrides,
  }
}

function makeJob(overrides: Partial<BenchmarkJob> = {}): BenchmarkJob {
  return {
    id: 'job-1', runId: 'run-1', corpusProjectId: 'proj-1', stage: 'experimental_trial', sourceId: 'src-1',
    outputId: null, fixtureId: null, intensity: null, benchmarkCode: null, conditionId: null, trialIndex: null,
    status: 'running', attemptCount: 1, createdAt: '', startedAt: null, completedAt: null, errorCode: null,
    errorMessage: null, leaseOwner: null, leaseAcquiredAt: null, leaseExpiresAt: null, nextAttemptAt: null,
    lastHeartbeatAt: null, failureClass: null,
    ...overrides,
  }
}

describe('experimental trial intensity regression (§23)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('A2H-07: medical source at requested intensity 9 records appliedIntensity 5 (capped) on the persisted trial', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => jsonResponse(200, { classification: 'ai', class_probabilities: { human: 0.1, ai: 0.8, mixed: 0.1 } })))
    const { firestore } = makeFirestore()
    const run = makeRun({ id: 'run-a2h07' })
    const source = makeSource({ domainId: 'medical' })
    const job = makeJob({ runId: run.id, sourceId: source.id, benchmarkCode: 'A2H-07', intensity: 9, conditionId: 'cond-1', trialIndex: 0 })

    await runA2H07Trial(firestore, run, source, job, { client: stubClient(), model: 'gpt-4o-mini', modelProvider: 'openai', gptZeroApiKey: 'test-key' })

    const trial = await getTrial(firestore, trialId(run.id, 'A2H-07', source.id, job.conditionId!, job.trialIndex!))
    expect(trial?.status).toBe('success')
    expect(trial?.condition['requestedIntensity']).toBe(9)
    expect(trial?.condition['appliedIntensity']).toBe(5)
    expect(trial?.condition['intensityCapped']).toBe(true)
  })

  it("A2H-11: legal domain's fixed style/tone intensity (5) records appliedIntensity 4 (capped)", async () => {
    const { firestore } = makeFirestore()
    const contrast = INITIAL_STYLE_TONE_CONTRASTS[0]!
    const run = makeRun({ id: 'run-a2h11', experimentConfig: { styleTone: { contrasts: INITIAL_STYLE_TONE_CONTRASTS, sourceSampleSize: null } } })
    const source = makeSource({ domainId: 'legal' })
    const job = makeJob({ runId: run.id, sourceId: source.id, benchmarkCode: 'A2H-11', conditionId: `${contrast.id}__left` })

    await runA2H11Trial(firestore, run, source, job, { client: stubClient(), model: 'gpt-4o-mini', modelProvider: 'openai' })

    const trial = await getTrial(firestore, trialId(run.id, 'A2H-11', source.id, job.conditionId!, 0))
    expect(trial?.status).toBe('success')
    expect(trial?.condition['intensity']).toBe(5) // A2H-11's own FIXED_INTENSITY
    expect(trial?.condition['requestedIntensity']).toBe(5)
    expect(trial?.condition['appliedIntensity']).toBe(4)
    expect(trial?.condition['intensityCapped']).toBe(true)
  })

  it("A2H-14: medical domain's fixed genre/audience intensity (5) sits exactly at the cap — applied 5, NOT capped", async () => {
    const { firestore } = makeFirestore()
    const contrast = INITIAL_GENRE_AUDIENCE_CONTRASTS[0]! // domain: 'medical'
    const run = makeRun({ id: 'run-a2h14', experimentConfig: { genreAudience: { contrasts: INITIAL_GENRE_AUDIENCE_CONTRASTS, sourceSampleSize: null } } })
    const source = makeSource({ domainId: 'general' }) // contrast.domain overrides source.domainId
    const job = makeJob({ runId: run.id, sourceId: source.id, benchmarkCode: 'A2H-14', conditionId: `${contrast.id}__left` })

    await runA2H14Trial(firestore, run, source, job, { client: stubClient(), model: 'gpt-4o-mini', modelProvider: 'openai' })

    const trial = await getTrial(firestore, trialId(run.id, 'A2H-14', source.id, job.conditionId!, 0))
    expect(trial?.status).toBe('success')
    expect(trial?.condition['domain']).toBe('medical')
    expect(trial?.condition['requestedIntensity']).toBe(5)
    expect(trial?.condition['appliedIntensity']).toBe(5)
    expect(trial?.condition['intensityCapped']).toBe(false)
  })

  it('A2H-15: technical domain requested intensity 8 caps BOTH arms to applied 7 identically', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => jsonResponse(200, { classification: 'ai', class_probabilities: { human: 0.1, ai: 0.8, mixed: 0.1 } })))
    const { firestore } = makeFirestore()
    const run = makeRun({ id: 'run-a2h15' })
    const source = makeSource({ domainId: 'technical' })
    const singleJob = makeJob({ runId: run.id, sourceId: source.id, benchmarkCode: 'A2H-15', conditionId: 'i8__single' })
    const productionJob = makeJob({ runId: run.id, sourceId: source.id, benchmarkCode: 'A2H-15', conditionId: 'i8__production' })

    await runA2H15Trial(firestore, run, source, singleJob, { client: stubClient(), model: 'gpt-4o-mini', modelProvider: 'openai', gptZeroApiKey: 'test-key' })
    await runA2H15Trial(firestore, run, source, productionJob, { client: stubClient(), model: 'gpt-4o-mini', modelProvider: 'openai', gptZeroApiKey: 'test-key' })

    const single = await getTrial(firestore, trialId(run.id, 'A2H-15', source.id, 'i8__single', 0))
    const production = await getTrial(firestore, trialId(run.id, 'A2H-15', source.id, 'i8__production', 0))
    expect(single?.status).toBe('success')
    expect(production?.status).toBe('success')
    expect(single?.condition['requestedIntensity']).toBe(8)
    expect(single?.condition['appliedIntensity']).toBe(7)
    expect(single?.condition['intensityCapped']).toBe(true)
    // Matched arms must always share IDENTICAL applied intensity — the
    // candidate-count override (single vs. production search) never changes
    // the domain-cap decision.
    expect(production?.condition['appliedIntensity']).toBe(single?.condition['appliedIntensity'])
    expect(production?.condition['intensityCapped']).toBe(single?.condition['intensityCapped'])
  })
})

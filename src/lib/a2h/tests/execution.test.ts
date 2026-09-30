import { describe, it, expect, vi, afterEach } from 'vitest'
import type { Firestore } from 'firebase-admin/firestore'
import type OpenAI from 'openai'
import type { Domain } from '@/lib/style/types'
import { executeRunBatch } from '../execution'
import { createRun, updateRunDraft, validateRun, startRun, pauseRun, resumeRun, listRunSources, getRunProgress, getRun } from '../runs'
import { createCorpusProject, updateProjectDraft, lockBlueprint, freezeCorpusProject } from '../corpusProject'
import { createTopic, listTopics } from '../topics'
import type { CreateTopicInput } from '../topics'
import { generateSource, freezeSource } from '../corpus'
import { listTestResultsForRun } from '../testResults'
import { getA2H02Rows } from '../a2h02'
import { getA2H03Report } from '../a2h03'
import { listJobsForRun } from '../jobs'

function makeFirestore() {
  const collections = new Map<string, Map<string, Record<string, unknown>>>()
  let counter = 0

  function docsFor(name: string) {
    if (!collections.has(name)) collections.set(name, new Map())
    return collections.get(name)!
  }

  function docRef(name: string, id: string) {
    const docs = docsFor(name)
    return {
      id,
      get: async () => ({ exists: docs.has(id), data: () => docs.get(id) }),
      set: async (data: Record<string, unknown>) => { docs.set(id, data) },
      update: async (patch: Record<string, unknown>) => { docs.set(id, { ...(docs.get(id) ?? {}), ...patch }) },
      delete: async () => { docs.delete(id) },
    }
  }

  function makeQuery(name: string, predicate: (d: Record<string, unknown>) => boolean) {
    return {
      where: (field: string, _op: string, value: unknown) => makeQuery(name, d => predicate(d) && d[field] === value),
      get: async () => ({ docs: [...docsFor(name).values()].filter(predicate).map(data => ({ data: () => data })) }),
    }
  }

  function collection(name: string) {
    return {
      doc: (id?: string) => docRef(name, id ?? `auto-${++counter}`),
      where: (field: string, _op: string, value: unknown) => makeQuery(name, d => d[field] === value),
      get: async () => ({ docs: [...docsFor(name).values()].map(data => ({ data: () => data })) }),
    }
  }

  return { firestore: { collection } as unknown as Firestore }
}

function words(n: number): string {
  return Array(n).fill('word').join(' ')
}

// A minimal, fully-controlled OpenAI-shaped stub for corpus generation —
// distinguishes nothing, just returns a word count matching whatever target
// the generation prompt asked for (generateSource itself controls
// max_tokens; content length is all that matters for wordCountTolerance).
function generationStubClient(targetWords: number): OpenAI {
  return {
    chat: { completions: { create: async () => ({ choices: [{ message: { content: words(targetWords) } }] }) } },
  } as unknown as OpenAI
}

// The Humanize pipeline stub — same pattern outputs.test.ts uses:
// distinguishes a json_object request (document-context/consistency calls)
// from the plain generation call.
function humanizeStubClient(): OpenAI {
  const chatCreate = vi.fn().mockImplementation(async (args: { response_format?: { type?: string } }) => {
    if (args.response_format?.type === 'json_object') {
      return { model: 'stub-model', choices: [{ message: { content: '{"entailment_probability": 0.9, "issues": []}' }, finish_reason: 'stop' }] }
    }
    return {
      model: 'stub-model',
      choices: [{ message: { content: 'A humanized rewrite of the source text, produced for integration-test purposes only.' }, finish_reason: 'stop' }],
      usage: { total_tokens: 500 },
    }
  })
  return { chat: { completions: { create: chatCreate } } } as unknown as OpenAI
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

async function buildFrozenCorpus(firestore: Firestore, opts: { domains: Domain[]; topicsPerDomain: number; lengths: number[] }): Promise<string> {
  const project = await createCorpusProject(firestore, { name: 'Dry Run Corpus' })
  await updateProjectDraft(firestore, project.id, {
    domains: opts.domains,
    topicCountDefault: opts.topicsPerDomain,
    lengthLadder: opts.lengths,
  })
  for (const domain of opts.domains) {
    for (let i = 1; i <= opts.topicsPerDomain; i++) {
      await createTopic(firestore, {
        corpusProjectId: project.id, domainId: domain, topicNumber: i, title: `${domain} topic ${i}`,
        description: 'd', intendedAudience: 'a', writingType: 'w', coreConcepts: ['c'], generationPromptVersion: 'GEN-V001',
      } as CreateTopicInput)
    }
  }
  await lockBlueprint(firestore, project.id)

  const topics = await listTopics(firestore, project.id)
  for (const topic of topics) {
    for (const targetWords of opts.lengths) {
      await generateSource(firestore, {
        corpusProjectId: project.id, topic, targetWords, temperature: null,
        client: generationStubClient(targetWords), model: 'stub', providerLabel: 'openai',
      })
      await freezeSource(firestore, project.id, topic.id, targetWords)
    }
  }
  await freezeCorpusProject(firestore, project.id)
  return project.id
}

const EXECUTE_OPTIONS = { model: 'stub-model', modelProvider: 'openai', gptZeroApiKey: 'test-key' }

// Runs executeRunBatch repeatedly (mirroring the UI's "Run All" loop) until
// the run leaves 'running' status, with a generous iteration cap so a bug
// that stalls progress fails the test instead of hanging it.
async function runToCompletion(firestore: Firestore, runId: string, client: OpenAI, maxIterations = 200): Promise<void> {
  for (let i = 0; i < maxIterations; i++) {
    const run = await getRun(firestore, runId)
    if (!run || run.status !== 'running') return
    await executeRunBatch(firestore, runId, { ...EXECUTE_OPTIONS, client, maxJobsPerStage: 25 })
  }
  throw new Error(`runToCompletion did not finish within ${maxIterations} iterations`)
}

// §28's dry-run acceptance configuration: 2 domains x 3 topics/domain x 3
// lengths = 18 sources; 3 intensities -> 18 x 3 = 54 outputs.
describe('dry-run acceptance (§28): 2 domains x 3 topics x 3 lengths x 3 intensities', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('produces exactly 18 baselines, 54 outputs, 54 post-scores, 54 A2H-01 rows, 54 A2H-02 rows, and A2H-03 aggregates with zero extra jobs', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => jsonResponse(200, {
      classification: 'ai',
      class_probabilities: { human: 0.05, ai: 0.9, mixed: 0.05 },
    })))

    const { firestore } = makeFirestore()
    const projectId = await buildFrozenCorpus(firestore, { domains: ['general', 'legal'], topicsPerDomain: 3, lengths: [100, 200, 300] })

    const run = await createRun(firestore, { corpusProjectId: projectId, name: 'Dry Run 001', modelProvider: 'openai', model: 'gpt-4o-mini' })
    await updateRunDraft(firestore, run.id, { intensities: [2, 5, 8] })
    const { result } = await validateRun(firestore, run.id, { hasModelConfig: true, hasDetectorConfig: true })
    expect(result.ok).toBe(true)

    const cohort = await listRunSources(firestore, run.id)
    expect(cohort).toHaveLength(18)

    await startRun(firestore, run.id)
    const client = humanizeStubClient()
    await runToCompletion(firestore, run.id, client)

    const finalRun = await getRun(firestore, run.id)
    expect(finalRun?.status).toBe('completed')
    expect(finalRun?.completedAt).not.toBeNull()

    const jobs = await listJobsForRun(firestore, run.id)
    expect(jobs.filter(j => j.stage === 'baseline_gptzero')).toHaveLength(18)
    expect(jobs.filter(j => j.stage === 'humanite_transform')).toHaveLength(54)
    expect(jobs.filter(j => j.stage === 'post_gptzero')).toHaveLength(54)
    expect(jobs.filter(j => j.stage === 'test_evaluation')).toHaveLength(108) // 54 outputs x (A2H-01 + A2H-02)
    expect(jobs.every(j => j.status === 'completed')).toBe(true)

    const a2h01Results = await listTestResultsForRun(firestore, run.id, 'A2H-01')
    const a2h02Results = await listTestResultsForRun(firestore, run.id, 'A2H-02')
    expect(a2h01Results).toHaveLength(54)
    expect(a2h02Results).toHaveLength(54)

    // A2H-03 is a pure aggregation — no jobs of any kind exist for it.
    expect(jobs.some(j => (j.benchmarkCode as string) === 'A2H-03')).toBe(false)
    const a2h03Report = await getA2H03Report(firestore, run.id)
    expect(a2h03Report.byLength.map(g => g.targetWords)).toEqual([100, 200, 300])
    for (const group of a2h03Report.byLength) expect(group.n).toBe(18) // 6 sources/length x 3 intensities

    const progress = await getRunProgress(firestore, run.id)
    expect(progress.sources).toBe(18)
    expect(progress.baselinesCompleted).toBe(18)
    expect(progress.outputsCompleted).toBe(54)
    expect(progress.postScoresCompleted).toBe(54)
    expect(progress.failedJobs).toBe(0)
    expect(progress.queuedJobs).toBe(0)
  })

  it('pause stops new work from starting; resume continues; no completed work repeats', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => jsonResponse(200, { classification: 'ai', class_probabilities: { human: 0.05, ai: 0.9, mixed: 0.05 } })))

    const { firestore } = makeFirestore()
    const projectId = await buildFrozenCorpus(firestore, { domains: ['general'], topicsPerDomain: 3, lengths: [100] })
    const run = await createRun(firestore, { corpusProjectId: projectId, name: 'Dry Run 002', modelProvider: 'openai', model: 'gpt-4o-mini' })
    await updateRunDraft(firestore, run.id, { intensities: [3, 6] })
    await validateRun(firestore, run.id, { hasModelConfig: true, hasDetectorConfig: true })
    await startRun(firestore, run.id)

    const client = humanizeStubClient()
    // Run exactly one small batch (baseline stage only), then pause.
    await executeRunBatch(firestore, run.id, { ...EXECUTE_OPTIONS, client, maxJobsPerStage: 1 })
    await pauseRun(firestore, run.id)

    const progressWhilePaused = await getRunProgress(firestore, run.id)
    const callsWhilePaused = (client.chat.completions.create as ReturnType<typeof vi.fn>).mock.calls.length

    // Calling execute while paused must be a safe no-op — no new work starts.
    const pausedResult = await executeRunBatch(firestore, run.id, { ...EXECUTE_OPTIONS, client, maxJobsPerStage: 25 })
    expect(pausedResult.processed).toBe(0)
    expect(pausedResult.stage).toBe('idle')
    const progressAfterPausedCall = await getRunProgress(firestore, run.id)
    expect(progressAfterPausedCall).toEqual(progressWhilePaused)
    expect((client.chat.completions.create as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsWhilePaused)

    await resumeRun(firestore, run.id)
    await runToCompletion(firestore, run.id, client)

    const finalRun = await getRun(firestore, run.id)
    expect(finalRun?.status).toBe('completed')
    const finalProgress = await getRunProgress(firestore, run.id)
    expect(finalProgress.baselinesCompleted).toBe(3) // 3 topics x 1 length
    expect(finalProgress.outputsCompleted).toBe(6) // 3 sources x 2 intensities
  })

  it('a completed run is idempotent to further execute calls', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => jsonResponse(200, { classification: 'human', class_probabilities: { human: 0.9, ai: 0.05, mixed: 0.05 } })))
    const { firestore } = makeFirestore()
    const projectId = await buildFrozenCorpus(firestore, { domains: ['general'], topicsPerDomain: 1, lengths: [100] })
    const run = await createRun(firestore, { corpusProjectId: projectId, name: 'Tiny Run', modelProvider: 'openai', model: 'gpt-4o-mini' })
    await updateRunDraft(firestore, run.id, { intensities: [4, 7] })
    await validateRun(firestore, run.id, { hasModelConfig: true, hasDetectorConfig: true })
    await startRun(firestore, run.id)
    const client = humanizeStubClient()
    await runToCompletion(firestore, run.id, client)

    const result = await executeRunBatch(firestore, run.id, { ...EXECUTE_OPTIONS, client })
    expect(result.processed).toBe(0)
    expect(result.stage).toBe('idle')
  })

  it('a second run against the same frozen corpus reuses baselines without any new GPTZero calls', async () => {
    const fetchMock = vi.fn().mockImplementation(() => jsonResponse(200, { classification: 'ai', class_probabilities: { human: 0.05, ai: 0.9, mixed: 0.05 } }))
    vi.stubGlobal('fetch', fetchMock)

    const { firestore } = makeFirestore()
    const projectId = await buildFrozenCorpus(firestore, { domains: ['general'], topicsPerDomain: 2, lengths: [100] })

    const runA = await createRun(firestore, { corpusProjectId: projectId, name: 'Run A', modelProvider: 'openai', model: 'gpt-4o-mini' })
    await updateRunDraft(firestore, runA.id, { intensities: [3, 6] })
    await validateRun(firestore, runA.id, { hasModelConfig: true, hasDetectorConfig: true })
    await startRun(firestore, runA.id)
    await runToCompletion(firestore, runA.id, humanizeStubClient())
    const fetchCallsAfterRunA = fetchMock.mock.calls.length

    const runB = await createRun(firestore, { corpusProjectId: projectId, name: 'Run B', modelProvider: 'openai', model: 'gpt-4o-mini' })
    await updateRunDraft(firestore, runB.id, { intensities: [3, 6] })
    await validateRun(firestore, runB.id, { hasModelConfig: true, hasDetectorConfig: true })
    await startRun(firestore, runB.id)
    // Baseline stage only — this is where cross-run reuse happens.
    await executeRunBatch(firestore, runB.id, { ...EXECUTE_OPTIONS, client: humanizeStubClient(), maxJobsPerStage: 10 })

    const progressB = await getRunProgress(firestore, runB.id)
    expect(progressB.baselinesCompleted).toBe(2)
    // No new fetch calls for baselines — every source was already baselined
    // under the exact same detector configuration by Run A.
    expect(fetchMock.mock.calls.length).toBe(fetchCallsAfterRunA)
  })

  it("Run A's outputs never appear in Run B's output/test-result listings", async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => jsonResponse(200, { classification: 'ai', class_probabilities: { human: 0.05, ai: 0.9, mixed: 0.05 } })))
    const { firestore } = makeFirestore()
    const projectId = await buildFrozenCorpus(firestore, { domains: ['general'], topicsPerDomain: 1, lengths: [100] })

    const runA = await createRun(firestore, { corpusProjectId: projectId, name: 'Run A', modelProvider: 'openai', model: 'gpt-4o-mini' })
    await updateRunDraft(firestore, runA.id, { intensities: [3, 6] })
    await validateRun(firestore, runA.id, { hasModelConfig: true, hasDetectorConfig: true })
    await startRun(firestore, runA.id)
    await runToCompletion(firestore, runA.id, humanizeStubClient())

    const runB = await createRun(firestore, { corpusProjectId: projectId, name: 'Run B', modelProvider: 'openai', model: 'gpt-4o-mini' })
    await updateRunDraft(firestore, runB.id, { intensities: [3, 6] })
    await validateRun(firestore, runB.id, { hasModelConfig: true, hasDetectorConfig: true })
    await startRun(firestore, runB.id)
    await runToCompletion(firestore, runB.id, humanizeStubClient())

    const a2h01A = await listTestResultsForRun(firestore, runA.id, 'A2H-01')
    const a2h01B = await listTestResultsForRun(firestore, runB.id, 'A2H-01')
    expect(a2h01A).toHaveLength(2)
    expect(a2h01B).toHaveLength(2)
    const idsA = new Set(a2h01A.map(r => r.id))
    expect(a2h01B.every(r => !idsA.has(r.id))).toBe(true)
    expect(a2h01A.every(r => r.runId === runA.id)).toBe(true)
    expect(a2h01B.every(r => r.runId === runB.id)).toBe(true)
  })

  it('A2H-02 measures the SAME frozen source across every selected intensity — never a different source per level', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => jsonResponse(200, { classification: 'ai', class_probabilities: { human: 0.05, ai: 0.9, mixed: 0.05 } })))
    const { firestore } = makeFirestore()
    const projectId = await buildFrozenCorpus(firestore, { domains: ['general'], topicsPerDomain: 1, lengths: [100] })
    const run = await createRun(firestore, { corpusProjectId: projectId, name: 'Run', modelProvider: 'openai', model: 'gpt-4o-mini' })
    await updateRunDraft(firestore, run.id, { intensities: [2, 5, 8] })
    await validateRun(firestore, run.id, { hasModelConfig: true, hasDetectorConfig: true })
    await startRun(firestore, run.id)
    await runToCompletion(firestore, run.id, humanizeStubClient())

    const rows = await getA2H02Rows(firestore, run.id)
    expect(rows).toHaveLength(3) // one intensity's roster (2, 5, 8), one source
    const sourceIds = new Set(rows.map(r => r.sourceId))
    expect(sourceIds.size).toBe(1) // the same source, not a distinct one per intensity
    expect(rows.map(r => r.intensity).sort((a, b) => a - b)).toEqual([2, 5, 8])
    // sourceWords is read from the same underlying CorpusSource for every
    // intensity — it must be identical across all three rows.
    const sourceWordsSet = new Set(rows.map(r => r.measurements.sourceWords))
    expect(sourceWordsSet.size).toBe(1)
  })
})

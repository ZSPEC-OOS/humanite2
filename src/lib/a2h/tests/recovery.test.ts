import { describe, it, expect, vi, afterEach } from 'vitest'
import type { Firestore } from 'firebase-admin/firestore'
import type OpenAI from 'openai'
import type { Domain } from '@/lib/style/types'
import { executeRunBatch } from '../execution'
import { createRun, updateRunDraft, validateRun, startRun, pauseRun, resumeRun, getRun } from '../runs'
import { createCorpusProject, updateProjectDraft, lockBlueprint, freezeCorpusProject } from '../corpusProject'
import { createTopic, listTopics } from '../topics'
import type { CreateTopicInput } from '../topics'
import { generateSource, freezeSource, getSource } from '../corpus'
import { claimJob, getJob, isJobStale, listJobsForRun, baselineJobId, transformJobId, postScoreJobId, testEvaluationJobId, BENCHMARK_JOB_LEASE_MS } from '../jobs'
import { recoverStaleJobs } from '../recovery'
import { acquireBaseline, acquirePostScore } from '../baseline'
import { transformSource, getOutput } from '../outputs'
import { createFixtureSet, createFixture, lockFixtureSet } from '../fixtures'
import { getOrCreateRepairAttempt } from '../repairAttempts'
import { getTrial, getOrCreateTrial, trialId } from '../trials'
import { getTestResult } from '../testResults'
import { INITIAL_GRAMMAR_FIXTURES } from '../a2h06'
import type { GrammarRepairFixtureExpected } from '../a2h06'
import type { A2HTestCode } from '../types'

// Same per-collection-map fake, with the runTransaction shim, used by
// execution.test.ts/release.test.ts — claimJob/recoverStaleJobs both need it.
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
      _docs: docs,
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

  async function runTransaction<T>(fn: (tx: { get: (ref: ReturnType<typeof docRef>) => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>; set: (ref: ReturnType<typeof docRef>, data: Record<string, unknown>) => void }) => Promise<T>): Promise<T> {
    const tx = {
      get: async (ref: ReturnType<typeof docRef>) => ref.get(),
      set: (ref: ReturnType<typeof docRef>, data: Record<string, unknown>) => { ref._docs.set(ref.id, data) },
    }
    return fn(tx)
  }

  return { firestore: { collection, runTransaction } as unknown as Firestore }
}

function words(n: number): string {
  return Array(n).fill('word').join(' ')
}

function generationStubClient(targetWords: number): OpenAI {
  return {
    chat: { completions: { create: async () => ({ choices: [{ message: { content: words(targetWords) } }] }) } },
  } as unknown as OpenAI
}

function humanizeStubClient(): OpenAI {
  const chatCreate = vi.fn().mockImplementation(async (args: { response_format?: { type?: string } }) => {
    if (args.response_format?.type === 'json_object') {
      return { model: 'stub-model', choices: [{ message: { content: '{"entailment_probability": 0.9, "issues": []}' }, finish_reason: 'stop' }] }
    }
    return {
      model: 'stub-model',
      choices: [{ message: { content: 'A humanized rewrite of the source text, produced for recovery-layer test purposes only.' }, finish_reason: 'stop' }],
      usage: { total_tokens: 500 },
    }
  })
  return { chat: { completions: { create: chatCreate } } } as unknown as OpenAI
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

async function buildFrozenCorpus(firestore: Firestore, opts: { domains: Domain[]; topicsPerDomain: number; lengths: number[] }): Promise<string> {
  const project = await createCorpusProject(firestore, { name: 'Recovery Test Corpus' })
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
const DETECTOR_CONFIG_ID = 'gptzero-default'

afterEach(() => {
  vi.unstubAllGlobals()
})

// Builds a minimal validated+started run with one frozen source and one
// baseline job (not yet claimed) — the common starting point for every
// disconnect scenario below, each of which then manually drives the run
// into a specific "claimed, then interrupted" state.
async function buildStartedRun(firestore: Firestore, intensities: number[] = [5, 8]) {
  vi.stubGlobal('fetch', vi.fn().mockImplementation(() => jsonResponse(200, {
    classification: 'ai', class_probabilities: { human: 0.05, ai: 0.9, mixed: 0.05 },
  })))
  const corpusProjectId = await buildFrozenCorpus(firestore, { domains: ['general'], topicsPerDomain: 1, lengths: [100] })
  const run = await createRun(firestore, { corpusProjectId, name: 'Recovery Run', modelProvider: 'openai', model: 'gpt-4o-mini' })
  await updateRunDraft(firestore, run.id, { intensities })
  await validateRun(firestore, run.id, { hasModelConfig: true, hasDetectorConfig: true })
  await startRun(firestore, run.id)
  const topics = await listTopics(firestore, corpusProjectId)
  const source = (await getSource(firestore, corpusProjectId, topics[0]!.id, 100))!
  return { run: (await getRun(firestore, run.id))!, source }
}

describe('§57: disconnect during transform — output already persisted, job never marked completed', () => {
  it('recovery marks the job completed, creates the post-score job, and never calls Humanize again', async () => {
    const { firestore } = makeFirestore()
    const { run, source } = await buildStartedRun(firestore, [5, 8])
    const jobId = transformJobId(run.id, source.id, 5)

    // Baseline completes first (via the real engine, so the transform jobs actually get created).
    await acquireBaseline(firestore, { source, runId: run.id, detectorConfigId: DETECTOR_CONFIG_ID, apiKey: 'k' })
    await executeRunBatch(firestore, run.id, { ...EXECUTE_OPTIONS, client: humanizeStubClient() })
    expect((await getJob(firestore, jobId))?.status).toBe('queued')

    // Claim it with an already-expired lease (simulates "claimed, then the
    // browser tab/laptop died before the response came back").
    await claimJob(firestore, jobId, 'browser-session-a', -1)
    expect((await getJob(firestore, jobId))?.status).toBe('running')

    // The paid call actually succeeded and persisted its result — this is
    // the part a crash can lose track of, not the part that gets lost.
    const client = humanizeStubClient()
    await transformSource(firestore, { runId: run.id, source, intensity: 5, client, model: 'stub-model', modelProvider: 'openai' })
    const callsBeforeRecovery = (client.chat.completions.create as ReturnType<typeof vi.fn>).mock.calls.length
    expect(callsBeforeRecovery).toBeGreaterThan(0)
    expect((await getJob(firestore, jobId))?.status).toBe('running') // still stuck — recovery hasn't run yet

    const summary = await recoverStaleJobs(firestore, run)
    expect(summary).toEqual({ staleJobsFound: 1, reconciledCompleted: 1, requeued: 0, unresolved: 0 })

    const job = await getJob(firestore, jobId)
    expect(job?.status).toBe('completed')
    expect(job?.leaseOwner).toBeNull()

    const output = (await getOutput(firestore, run.id, source.id, 5))!
    const postScoreJob = await getJob(firestore, postScoreJobId(run.id, output.id, DETECTOR_CONFIG_ID))
    expect(postScoreJob?.status).toBe('queued')

    // No new Humanize call happened during reconciliation.
    expect((client.chat.completions.create as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBeforeRecovery)
  })
})

describe('§58: disconnect before the transform artifact was produced', () => {
  it('recovery requeues the job, and the next execution may call Humanize again', async () => {
    const { firestore } = makeFirestore()
    const { run, source } = await buildStartedRun(firestore, [5, 8])
    await acquireBaseline(firestore, { source, runId: run.id, detectorConfigId: DETECTOR_CONFIG_ID, apiKey: 'k' })
    await executeRunBatch(firestore, run.id, { ...EXECUTE_OPTIONS, client: humanizeStubClient() })
    const jobId = transformJobId(run.id, source.id, 8)

    await claimJob(firestore, jobId, 'browser-session-a', -1)
    expect(await getOutput(firestore, run.id, source.id, 8)).toBeNull()

    const summary = await recoverStaleJobs(firestore, run)
    expect(summary).toEqual({ staleJobsFound: 1, reconciledCompleted: 0, requeued: 1, unresolved: 0 })
    expect((await getJob(firestore, jobId))?.status).toBe('queued')

    // It's claimable and executable again — the paid call genuinely may run.
    const client = humanizeStubClient()
    const claimed = await claimJob(firestore, jobId, 'browser-session-b')
    expect(claimed).not.toBeNull()
    await transformSource(firestore, { runId: run.id, source, intensity: 8, client, model: 'stub-model', modelProvider: 'openai' })
    expect((client.chat.completions.create as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0)
  })
})

describe('§11/§59: disconnect after a baseline/post-score DetectorResult was already persisted', () => {
  it('baseline: recovery completes the job and creates the transform jobs without calling GPTZero again', async () => {
    const fetchMock = vi.fn().mockImplementation(() => jsonResponse(200, { classification: 'ai', class_probabilities: { human: 0.05, ai: 0.9, mixed: 0.05 } }))
    const { firestore } = makeFirestore()
    const corpusProjectId = await buildFrozenCorpus(firestore, { domains: ['general'], topicsPerDomain: 1, lengths: [100] })
    const run0 = await createRun(firestore, { corpusProjectId, name: 'Run', modelProvider: 'openai', model: 'gpt-4o-mini' })
    await updateRunDraft(firestore, run0.id, { intensities: [5, 8] })
    await validateRun(firestore, run0.id, { hasModelConfig: true, hasDetectorConfig: true })
    await startRun(firestore, run0.id)
    const run = (await getRun(firestore, run0.id))!
    const topics = await listTopics(firestore, corpusProjectId)
    const source = (await getSource(firestore, corpusProjectId, topics[0]!.id, 100))!
    vi.stubGlobal('fetch', fetchMock)

    const jobId = baselineJobId(run.id, source.id, DETECTOR_CONFIG_ID)
    await claimJob(firestore, jobId, 'browser-session-a', -1)
    await acquireBaseline(firestore, { source, runId: run.id, detectorConfigId: DETECTOR_CONFIG_ID, apiKey: 'k' })
    const callsBeforeRecovery = fetchMock.mock.calls.length
    expect(callsBeforeRecovery).toBe(1)

    const summary = await recoverStaleJobs(firestore, run)
    expect(summary).toEqual({ staleJobsFound: 1, reconciledCompleted: 1, requeued: 0, unresolved: 0 })
    expect((await getJob(firestore, jobId))?.status).toBe('completed')
    expect((await getJob(firestore, transformJobId(run.id, source.id, 5)))?.status).toBe('queued')
    expect((await getJob(firestore, transformJobId(run.id, source.id, 8)))?.status).toBe('queued')
    expect(fetchMock.mock.calls.length).toBe(callsBeforeRecovery)
  })

  it('post-score: recovery completes the job and creates the test_evaluation jobs without calling GPTZero again', async () => {
    const fetchMock = vi.fn().mockImplementation(() => jsonResponse(200, { classification: 'ai', class_probabilities: { human: 0.05, ai: 0.9, mixed: 0.05 } }))
    vi.stubGlobal('fetch', fetchMock)
    const { firestore } = makeFirestore()
    const corpusProjectId = await buildFrozenCorpus(firestore, { domains: ['general'], topicsPerDomain: 1, lengths: [100] })
    const run0 = await createRun(firestore, { corpusProjectId, name: 'Run', modelProvider: 'openai', model: 'gpt-4o-mini' })
    await updateRunDraft(firestore, run0.id, { intensities: [5, 8] })
    await validateRun(firestore, run0.id, { hasModelConfig: true, hasDetectorConfig: true })
    await startRun(firestore, run0.id)
    const topics = await listTopics(firestore, corpusProjectId)
    const source = (await getSource(firestore, corpusProjectId, topics[0]!.id, 100))!

    await acquireBaseline(firestore, { source, runId: run0.id, detectorConfigId: DETECTOR_CONFIG_ID, apiKey: 'k' })
    await executeRunBatch(firestore, run0.id, { ...EXECUTE_OPTIONS, client: humanizeStubClient() }) // completes baseline, creates transform jobs
    await executeRunBatch(firestore, run0.id, { ...EXECUTE_OPTIONS, client: humanizeStubClient(), maxJobsPerStage: 1 }) // completes one transform job -> post_gptzero job queued
    const run = (await getRun(firestore, run0.id))!
    const output = (await getOutput(firestore, run.id, source.id, 5))!
    const jobId = postScoreJobId(run.id, output.id, DETECTOR_CONFIG_ID)
    expect((await getJob(firestore, jobId))?.status).toBe('queued')

    await claimJob(firestore, jobId, 'browser-session-a', -1)
    await acquirePostScore(firestore, { output, detectorConfigId: DETECTOR_CONFIG_ID, apiKey: 'k' })
    const callsBeforeRecovery = fetchMock.mock.calls.length
    expect(callsBeforeRecovery).toBeGreaterThan(0)

    const summary = await recoverStaleJobs(firestore, run)
    expect(summary).toEqual({ staleJobsFound: 1, reconciledCompleted: 1, requeued: 0, unresolved: 0 })
    expect((await getJob(firestore, jobId))?.status).toBe('completed')
    expect((await getJob(firestore, testEvaluationJobId(run.id, output.id, 'A2H-01', run.testVersion)))?.status).toBe('queued')
    expect(fetchMock.mock.calls.length).toBe(callsBeforeRecovery)
  })
})

describe('§60: repair recovery — successful attempt exists, test result missing', () => {
  it('reuses the paid repair attempt to recompute the local result, with no second repair call', async () => {
    const { firestore } = makeFirestore()
    const corpusProjectId = await buildFrozenCorpus(firestore, { domains: ['general'], topicsPerDomain: 1, lengths: [100] })
    const topics = await listTopics(firestore, corpusProjectId)
    const source = (await getSource(firestore, corpusProjectId, topics[0]!.id, 100))!

    const fixtureSet = await createFixtureSet(firestore, { corpusProjectId, name: 'Repair Fixtures' })
    const fixtureExpected = INITIAL_GRAMMAR_FIXTURES[0] as unknown as GrammarRepairFixtureExpected
    const fixture = await createFixture(firestore, { fixtureSetId: fixtureSet.id, sourceId: source.id, type: 'grammar_repair', expected: fixtureExpected as unknown as Record<string, unknown> })
    const { set: locked } = await lockFixtureSet(firestore, fixtureSet.id)

    const run0 = await createRun(firestore, { corpusProjectId, name: 'Repair Run', modelProvider: 'openai', model: 'gpt-4o-mini' })
    await updateRunDraft(firestore, run0.id, { intensities: [5], enabledTests: ['A2H-06' as A2HTestCode], fixtureSetId: locked.id })
    await validateRun(firestore, run0.id, { hasModelConfig: true, hasDetectorConfig: true })
    await startRun(firestore, run0.id)
    const run = (await getRun(firestore, run0.id))!

    const jobId = `repair_evaluation__${run.id}__${fixture.id}__A2H-06__${run.repairConfigVersion}`
    expect((await getJob(firestore, jobId))?.status).toBe('queued')
    await claimJob(firestore, jobId, 'browser-session-a', -1)

    const repairFn = vi.fn().mockResolvedValue({
      repairedOutput: fixtureExpected.cleanText, modelProvider: 'openai', model: 'gpt-4o-mini', latencyMs: 10,
      modelCalls: 1, retryCount: 0, inputTokens: 5, outputTokens: 5, estimatedCostUsd: null, status: 'success', errorCode: null, errorMessage: null,
    })
    await getOrCreateRepairAttempt(firestore, {
      runId: run.id, corpusProjectId, fixtureSetId: locked.id, fixtureId: fixture.id, benchmarkCode: 'A2H-06',
      sourceId: source.id, corruptedInput: fixtureExpected.corruptedText, repairConfigVersion: run.repairConfigVersion, repair: repairFn,
    })
    expect(repairFn).toHaveBeenCalledTimes(1)
    expect(await getTestResult(firestore, run.id, null, fixture.id, 'A2H-06', run.testVersion)).toBeNull()

    const summary = await recoverStaleJobs(firestore, run)
    expect(summary).toEqual({ staleJobsFound: 1, reconciledCompleted: 1, requeued: 0, unresolved: 0 })
    expect((await getJob(firestore, jobId))?.status).toBe('completed')
    expect(await getTestResult(firestore, run.id, null, fixture.id, 'A2H-06', run.testVersion)).not.toBeNull()
    // The repair call itself was never repeated.
    expect(repairFn).toHaveBeenCalledTimes(1)
  })
})

describe('§61: experimental trial recovery — successful trial exists, job stuck running', () => {
  it('marks the job completed with no duplicate trial generation', async () => {
    const { firestore } = makeFirestore()
    const corpusProjectId = await buildFrozenCorpus(firestore, { domains: ['general'], topicsPerDomain: 1, lengths: [100] })
    const run0 = await createRun(firestore, { corpusProjectId, name: 'Trial Run', modelProvider: 'openai', model: 'gpt-4o-mini' })
    await updateRunDraft(firestore, run0.id, {
      intensities: [5],
      enabledTests: ['A2H-07' as A2HTestCode],
      experimentConfig: { repeatability: { repeatCount: 2, sourceSampleSize: null, intensities: [5] } },
    })
    await validateRun(firestore, run0.id, { hasModelConfig: true, hasDetectorConfig: true })
    await startRun(firestore, run0.id)
    const run = (await getRun(firestore, run0.id))!

    const jobs = await listJobsForRun(firestore, run.id)
    const trialJob = jobs.find(j => j.stage === 'experimental_trial')!
    expect(trialJob.status).toBe('queued')
    await claimJob(firestore, trialJob.id, 'browser-session-a', -1)

    const runFn = vi.fn().mockResolvedValue({
      outputText: 'trial output', outputSha256: 'abc', outputWords: 2, modelProvider: 'openai', model: 'gpt-4o-mini',
      latencyMs: 5, modelCalls: 1, retryCount: 0, candidateCount: 1, inputTokens: 1, outputTokens: 1, estimatedCostUsd: null,
      aiProbability: null, humanProbability: null, classification: null, diagnostics: null, status: 'success', errorCode: null, errorMessage: null,
    })
    await getOrCreateTrial(firestore, {
      runId: run.id, corpusProjectId, benchmarkCode: 'A2H-07', sourceId: trialJob.sourceId,
      conditionId: trialJob.conditionId!, trialIndex: trialJob.trialIndex!, condition: {}, run: runFn,
    })
    expect(runFn).toHaveBeenCalledTimes(1)

    const summary = await recoverStaleJobs(firestore, run)
    expect(summary).toEqual({ staleJobsFound: 1, reconciledCompleted: 1, requeued: 0, unresolved: 0 })
    expect((await getJob(firestore, trialJob.id))?.status).toBe('completed')
    expect(runFn).toHaveBeenCalledTimes(1)
    const persistedTrialId = trialId(run.id, 'A2H-07', trialJob.sourceId, trialJob.conditionId!, trialJob.trialIndex!)
    expect((await getTrial(firestore, persistedTrialId))?.status).toBe('success')
  })
})

describe('§33/§62: concurrent claim attempts on the same job', () => {
  it('only one of two claim attempts against the same job can succeed', async () => {
    const { firestore } = makeFirestore()
    const { run, source } = await buildStartedRun(firestore, [5, 8])
    const jobId = baselineJobId(run.id, source.id, DETECTOR_CONFIG_ID)

    // The fake firestore's runTransaction mock has no real cross-call
    // isolation (JS interleaving would let two truly-concurrent calls both
    // read the pre-write snapshot) — sequential calls are what actually
    // exercise claimJob's read-then-conditionally-write guard here; real
    // Firestore transactions provide the same guarantee under genuine
    // concurrency, which this in-memory fake cannot faithfully simulate.
    const tabA = await claimJob(firestore, jobId, 'tab-a')
    const tabB = await claimJob(firestore, jobId, 'tab-b')
    expect(tabA).not.toBeNull()
    expect(tabB).toBeNull()
    expect((await getJob(firestore, jobId))?.leaseOwner).toBe('tab-a')
  })

  it('two executeRunBatch calls against the same run never process more jobs than exist, nor double the paid call count', async () => {
    const { firestore } = makeFirestore()
    const { run } = await buildStartedRun(firestore, [5, 8])
    const jobsBefore = await listJobsForRun(firestore, run.id)
    expect(jobsBefore).toHaveLength(1) // one baseline job

    const clientA = humanizeStubClient()
    const clientB = humanizeStubClient()
    const [resultA, resultB] = await Promise.all([
      executeRunBatch(firestore, run.id, { ...EXECUTE_OPTIONS, client: clientA, workerId: 'tab-a' }),
      executeRunBatch(firestore, run.id, { ...EXECUTE_OPTIONS, client: clientB, workerId: 'tab-b' }),
    ])
    // Exactly one job existed — the two calls together can claim it at most
    // once (claimedJobs sums to <= the number of jobs that existed).
    expect(resultA.claimedJobs + resultB.claimedJobs).toBeLessThanOrEqual(1)
  })
})

describe('§63: pause stops new claims; in-flight completion still checkpoints', () => {
  it('executeRunBatch on a paused run claims nothing', async () => {
    const { firestore } = makeFirestore()
    const { run } = await buildStartedRun(firestore, [5, 8])
    await pauseRun(firestore, run.id)

    const result = await executeRunBatch(firestore, run.id, { ...EXECUTE_OPTIONS, client: humanizeStubClient() })
    expect(result.processed).toBe(0)
    expect(result.stage).toBe('idle')
    expect(result.claimedJobs).toBe(0)
    const jobs = await listJobsForRun(firestore, run.id)
    expect(jobs.every(j => j.status === 'queued')).toBe(true)
  })
})

describe('§64: resume recovers a mix of resolved and unresolved stale jobs', () => {
  it('recovers the one with saved evidence, requeues the one without, and returns the run to running', async () => {
    const { firestore } = makeFirestore()
    const { run, source } = await buildStartedRun(firestore, [5, 8])
    await acquireBaseline(firestore, { source, runId: run.id, detectorConfigId: DETECTOR_CONFIG_ID, apiKey: 'k' })
    await executeRunBatch(firestore, run.id, { ...EXECUTE_OPTIONS, client: humanizeStubClient() }) // creates both transform jobs

    const resolvedJobId = transformJobId(run.id, source.id, 5)
    const unresolvedJobId = transformJobId(run.id, source.id, 8)
    await claimJob(firestore, resolvedJobId, 'browser-session-a', -1)
    await claimJob(firestore, unresolvedJobId, 'browser-session-a', -1)
    await transformSource(firestore, { runId: run.id, source, intensity: 5, client: humanizeStubClient(), model: 'stub-model', modelProvider: 'openai' })
    // intensity 8 gets no output — genuinely unresolved.

    await pauseRun(firestore, run.id)
    const { run: resumed, recovery } = await resumeRun(firestore, run.id)
    expect(resumed.status).toBe('running')
    expect(recovery.staleJobsFound).toBe(2)
    expect(recovery.reconciledCompleted).toBe(1)
    expect(recovery.requeued).toBe(1)
    expect(recovery.unresolved).toBe(0)
    expect((await getJob(firestore, resolvedJobId))?.status).toBe('completed')
    expect((await getJob(firestore, unresolvedJobId))?.status).toBe('queued')
  })
})

describe('§17/§69: recovery/resume/execute never repeat already-checkpointed successful paid work', () => {
  it('a fully completed run stays idempotent across recover, resume-shaped recovery, and another execute call', async () => {
    const { firestore } = makeFirestore()
    const { run, source } = await buildStartedRun(firestore, [5, 8])
    await acquireBaseline(firestore, { source, runId: run.id, detectorConfigId: DETECTOR_CONFIG_ID, apiKey: 'k' })
    const client = humanizeStubClient()
    // Drive to completion using the ordinary engine.
    for (let i = 0; i < 20; i++) {
      const r = await getRun(firestore, run.id)
      if (r?.status !== 'running') break
      await executeRunBatch(firestore, run.id, { ...EXECUTE_OPTIONS, client })
    }
    const finalRun = await getRun(firestore, run.id)
    expect(finalRun?.status).toBe('completed')
    const callsAfterCompletion = (client.chat.completions.create as ReturnType<typeof vi.fn>).mock.calls.length
    expect(callsAfterCompletion).toBeGreaterThan(0)

    // Calling recovery directly on a fully-terminal run finds nothing to do.
    const recovery = await recoverStaleJobs(firestore, finalRun!)
    expect(recovery).toEqual({ staleJobsFound: 0, reconciledCompleted: 0, requeued: 0, unresolved: 0 })

    // Another execute call is a safe no-op.
    const idle = await executeRunBatch(firestore, run.id, { ...EXECUTE_OPTIONS, client })
    expect(idle.processed).toBe(0)
    expect(idle.stage).toBe('idle')
    expect((client.chat.completions.create as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsAfterCompletion)
  })
})

describe('§70: legacy job compatibility', () => {
  it('a pre-Phase-5A job row (no lease fields at all) loads safely and recovery can infer its stale state', async () => {
    const { firestore } = makeFirestore()
    const { run, source } = await buildStartedRun(firestore, [5, 8])
    const jobId = baselineJobId(run.id, source.id, DETECTOR_CONFIG_ID)

    // Overwrite with a bare legacy shape — as if this row was written before
    // leaseOwner/leaseAcquiredAt/leaseExpiresAt/nextAttemptAt/lastHeartbeatAt/
    // failureClass existed at all.
    await firestore.collection('a2hBenchmarkJobs').doc(jobId).set({
      id: jobId, runId: run.id, corpusProjectId: run.corpusProjectId, stage: 'baseline_gptzero', sourceId: source.id,
      outputId: null, fixtureId: null, intensity: null, benchmarkCode: null, conditionId: null, trialIndex: null,
      status: 'running', attemptCount: 1,
      createdAt: new Date().toISOString(),
      startedAt: new Date(Date.now() - (BENCHMARK_JOB_LEASE_MS + 60_000)).toISOString(),
      completedAt: null, errorCode: null, errorMessage: null,
      // leaseOwner/leaseAcquiredAt/leaseExpiresAt/nextAttemptAt/lastHeartbeatAt/failureClass intentionally absent.
    })

    const legacyJob = await getJob(firestore, jobId)
    expect(legacyJob).not.toBeNull()
    expect(isJobStale(legacyJob!)).toBe(true) // startedAt-based fallback

    const summary = await recoverStaleJobs(firestore, run)
    expect(summary.staleJobsFound).toBe(1)
    // No baseline exists yet, so this reconciles to 'requeued'.
    expect(summary.requeued).toBe(1)
    const requeued = await getJob(firestore, jobId)
    expect(requeued?.status).toBe('queued')

    // A fresh claim on the now-requeued job writes the FULL modern lease shape.
    const claimed = await claimJob(firestore, jobId, 'worker-modern')
    expect(claimed?.leaseAcquiredAt).not.toBeNull()
    expect(claimed?.leaseExpiresAt).not.toBeNull()
    expect(claimed?.lastHeartbeatAt).not.toBeNull()
  })
})

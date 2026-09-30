import { describe, it, expect, vi, afterEach } from 'vitest'
import type { Firestore } from 'firebase-admin/firestore'
import type OpenAI from 'openai'
import type { Domain } from '@/lib/style/types'
import { executeRunBatch, ExecutionConfigMismatchError } from '../execution'
import { createRun, updateRunDraft, validateRun, startRun, pauseRun, resumeRun, listRunSources, getRunProgress, getRun } from '../runs'
import { createCorpusProject, updateProjectDraft, lockBlueprint, freezeCorpusProject } from '../corpusProject'
import { createTopic, listTopics } from '../topics'
import type { CreateTopicInput } from '../topics'
import { generateSource, freezeSource, getSource } from '../corpus'
import { listTestResultsForRun } from '../testResults'
import { getA2H02Rows } from '../a2h02'
import { getA2H03Report } from '../a2h03'
import { listJobsForRun } from '../jobs'
import { createFixtureSet, createFixture, lockFixtureSet } from '../fixtures'
import { INITIAL_GRAMMAR_FIXTURES } from '../a2h06'
import { INITIAL_FACTUAL_FIXTURES } from '../a2h12'
import { listRepairAttemptsForRun } from '../repairAttempts'
import type { A2HTestCode } from '../types'
import { getExperimentCohort } from '../experimentCohort'
import { listTrialsForRun } from '../trials'
import { getA2H07Report } from '../a2h07'
import { getA2H11Report } from '../a2h11'
import { getA2H14Report } from '../a2h14'
import { getA2H15Report } from '../a2h15'
import { getA2H17Report, collectOperationRecords } from '../a2h17'

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

  // A single-threaded transaction mock — sufficient for claimJob's
  // read-then-conditionally-write logic under vitest's sequential execution
  // (no real concurrent callers within one test).
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

const EXECUTE_OPTIONS = { model: 'gpt-4o-mini', modelProvider: 'openai', gptZeroApiKey: 'test-key' }

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

// §46's dry-run integration test for Phase 2's fixture-backed deterministic
// tests: 1 frozen source, 2 intensities, all 5 of A2H-04/05/09/10/13
// enabled (no A2H-01/02/03) — proves the deterministic tests plug into the
// existing pipeline without a second job engine, without any extra
// Humanite/GPTZero calls of their own, and idempotently.
describe('dry-run acceptance (§46): fixture-backed deterministic tests', () => {
  const DETERMINISTIC_CODES: A2HTestCode[] = ['A2H-04', 'A2H-05', 'A2H-09', 'A2H-10', 'A2H-13']

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function buildRunWithFixtures(firestore: Firestore) {
    const projectId = await buildFrozenCorpus(firestore, { domains: ['general'], topicsPerDomain: 1, lengths: [100] })
    const topics = await listTopics(firestore, projectId)
    const source = await getSource(firestore, projectId, topics[0]!.id, 100)

    const fixtureSet = await createFixtureSet(firestore, { corpusProjectId: projectId, name: 'Test Fixtures' })
    await createFixture(firestore, {
      fixtureSetId: fixtureSet.id, sourceId: source!.id, type: 'citation',
      expected: { kind: 'numeric', exactText: '[1]', normalizedText: '[1]' },
    })
    await createFixture(firestore, {
      fixtureSetId: fixtureSet.id, sourceId: source!.id, type: 'numeric_unit',
      expected: { kind: 'value_unit', exactText: '5 mg', numericValue: 5, unit: 'mg', rangeStart: null, rangeEnd: null, sign: null, exponent: null, normalizedValue: '5 mg' },
    })
    await createFixture(firestore, {
      fixtureSetId: fixtureSet.id, sourceId: source!.id, type: 'modality',
      expected: { exactText: 'may', category: 'permission', strength: 2, approvedEquivalentForms: [], anchorText: 'patients may discontinue' },
    })
    await createFixture(firestore, {
      fixtureSetId: fixtureSet.id, sourceId: source!.id, type: 'protected_term',
      expected: { kind: 'gene', exactText: 'BRCA1', caseSensitive: true, allowedVariants: [] },
    })
    await createFixture(firestore, {
      fixtureSetId: fixtureSet.id, sourceId: source!.id, type: 'terminology',
      expected: { preferredTerm: 'myocardial infarction', allowedVariants: ['MI'], forbiddenVariants: ['heart episode'], caseSensitive: false, expectedMinimumOccurrences: null },
    })
    const { set: locked, result } = await lockFixtureSet(firestore, fixtureSet.id)
    expect(result.ok).toBe(true)
    expect(locked.status).toBe('locked')

    const run = await createRun(firestore, { corpusProjectId: projectId, name: 'Fixture Run', modelProvider: 'openai', model: 'gpt-4o-mini' })
    await updateRunDraft(firestore, run.id, { intensities: [3, 6], enabledTests: DETERMINISTIC_CODES, fixtureSetId: locked.id })
    return run.id
  }

  it('produces exactly one A2H-04/05/09/10/13 result per output, with no extra Humanite or GPTZero calls', async () => {
    const fetchMock = vi.fn().mockImplementation(() => jsonResponse(200, { classification: 'ai', class_probabilities: { human: 0.05, ai: 0.9, mixed: 0.05 } }))
    vi.stubGlobal('fetch', fetchMock)

    const { firestore } = makeFirestore()
    const runId = await buildRunWithFixtures(firestore)

    const { result } = await validateRun(firestore, runId, { hasModelConfig: true, hasDetectorConfig: true })
    expect(result.ok).toBe(true)
    const validated = await getRun(firestore, runId)
    expect(validated?.fixtureSetId).not.toBeNull()
    expect(validated?.fixtureVersion).toBe('FIXTURE-V001')

    await startRun(firestore, runId)
    const client = humanizeStubClient()
    await runToCompletion(firestore, runId, client)

    const finalRun = await getRun(firestore, runId)
    expect(finalRun?.status).toBe('completed')

    // 1 source -> 2 Humanite outputs (one per intensity); GPTZero is called
    // once for the baseline and once per output for post-score — exactly
    // the same shape as a run with no deterministic tests at all.
    expect((client.chat.completions.create as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0)
    expect(fetchMock.mock.calls.length).toBe(3) // 1 baseline + 2 post-scores

    const jobs = await listJobsForRun(firestore, runId)
    expect(jobs.filter(j => j.stage === 'humanite_transform')).toHaveLength(2)
    expect(jobs.filter(j => j.stage === 'test_evaluation')).toHaveLength(10) // 2 outputs x 5 tests

    for (const code of DETERMINISTIC_CODES) {
      const results = await listTestResultsForRun(firestore, runId, code)
      expect(results).toHaveLength(2)
      for (const r of results) {
        expect(r.measurements['eligible']).toBe(true)
        expect(r.measurements['fixtureCount']).toBe(1)
      }
    }
  })

  it('re-running a completed run does not duplicate deterministic test results (§47 idempotency)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => jsonResponse(200, { classification: 'ai', class_probabilities: { human: 0.05, ai: 0.9, mixed: 0.05 } })))
    const { firestore } = makeFirestore()
    const runId = await buildRunWithFixtures(firestore)
    await validateRun(firestore, runId, { hasModelConfig: true, hasDetectorConfig: true })
    await startRun(firestore, runId)
    await runToCompletion(firestore, runId, humanizeStubClient())

    const before = await listTestResultsForRun(firestore, runId, 'A2H-04')
    const idsBefore = before.map(r => r.id).sort()

    const result = await executeRunBatch(firestore, runId, { ...EXECUTE_OPTIONS, client: humanizeStubClient() })
    expect(result.processed).toBe(0)
    expect(result.stage).toBe('idle')

    const after = await listTestResultsForRun(firestore, runId, 'A2H-04')
    expect(after).toHaveLength(before.length)
    expect(after.map(r => r.id).sort()).toEqual(idsBefore)
  })
})

// §57's integration test: 2 grammar_repair fixtures, 2 factual_repair
// fixtures, and A2H-08 exercised on the run's one normal output — proving
// the repair_evaluation stage plugs into the existing engine (no second
// execution path), persists both BenchmarkTestResult rows AND
// BenchmarkRepairAttempt rows, and never duplicates a paid repair call on
// resume/retry.
describe('dry-run acceptance (§57): grammar/factual repair + grammar damage', () => {
  const REPAIR_CODES: A2HTestCode[] = ['A2H-06', 'A2H-08', 'A2H-12']

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function buildRunWithRepairFixtures(firestore: Firestore) {
    const projectId = await buildFrozenCorpus(firestore, { domains: ['general'], topicsPerDomain: 1, lengths: [100] })
    const topics = await listTopics(firestore, projectId)
    const source = await getSource(firestore, projectId, topics[0]!.id, 100)

    const fixtureSet = await createFixtureSet(firestore, { corpusProjectId: projectId, name: 'Repair Fixtures' })
    for (const g of INITIAL_GRAMMAR_FIXTURES.slice(0, 2)) {
      await createFixture(firestore, { fixtureSetId: fixtureSet.id, sourceId: source!.id, type: 'grammar_repair', expected: g as unknown as Record<string, unknown> })
    }
    for (const f of INITIAL_FACTUAL_FIXTURES.slice(0, 2)) {
      await createFixture(firestore, { fixtureSetId: fixtureSet.id, sourceId: source!.id, type: 'factual_repair', expected: f as unknown as Record<string, unknown> })
    }
    const { set: locked, result } = await lockFixtureSet(firestore, fixtureSet.id)
    expect(result.ok).toBe(true)

    const run = await createRun(firestore, { corpusProjectId: projectId, name: 'Repair Run', modelProvider: 'openai', model: 'gpt-4o-mini' })
    await updateRunDraft(firestore, run.id, { intensities: [5], enabledTests: REPAIR_CODES, fixtureSetId: locked.id })
    return run.id
  }

  it('executes A2H-06/A2H-08/A2H-12, persists results and repair attempts, and never double-enqueues on resume', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => jsonResponse(200, { classification: 'ai', class_probabilities: { human: 0.05, ai: 0.9, mixed: 0.05 } })))

    const { firestore } = makeFirestore()
    const runId = await buildRunWithRepairFixtures(firestore)

    const { result } = await validateRun(firestore, runId, { hasModelConfig: true, hasDetectorConfig: true })
    expect(result.ok).toBe(true)

    await startRun(firestore, runId)
    await runToCompletion(firestore, runId, humanizeStubClient())

    const finalRun = await getRun(firestore, runId)
    expect(finalRun?.status).toBe('completed')

    const jobs = await listJobsForRun(firestore, runId)
    expect(jobs.filter(j => j.stage === 'repair_evaluation' && j.benchmarkCode === 'A2H-06')).toHaveLength(2)
    expect(jobs.filter(j => j.stage === 'repair_evaluation' && j.benchmarkCode === 'A2H-12')).toHaveLength(2)
    expect(jobs.filter(j => j.stage === 'test_evaluation' && j.benchmarkCode === 'A2H-08')).toHaveLength(1) // 1 source x 1 intensity
    expect(jobs.every(j => j.status === 'completed')).toBe(true)

    const a2h06Results = await listTestResultsForRun(firestore, runId, 'A2H-06')
    const a2h12Results = await listTestResultsForRun(firestore, runId, 'A2H-12')
    const a2h08Results = await listTestResultsForRun(firestore, runId, 'A2H-08')
    expect(a2h06Results).toHaveLength(2)
    expect(a2h12Results).toHaveLength(2)
    expect(a2h08Results).toHaveLength(1)
    expect(a2h06Results.every(r => r.outputId === null && r.fixtureId != null)).toBe(true)
    expect(a2h12Results.every(r => r.outputId === null && r.fixtureId != null)).toBe(true)
    expect(a2h08Results.every(r => r.outputId != null && r.fixtureId === null)).toBe(true)

    const grammarAttempts = await listRepairAttemptsForRun(firestore, runId, 'A2H-06')
    const factualAttempts = await listRepairAttemptsForRun(firestore, runId, 'A2H-12')
    expect(grammarAttempts).toHaveLength(2)
    expect(factualAttempts).toHaveLength(2)
    expect(grammarAttempts.every(a => a.status === 'success')).toBe(true)
    expect(factualAttempts.every(a => a.status === 'success')).toBe(true)

    // Idempotency: re-running must not duplicate jobs, results, or paid
    // repair attempts — nor make any new model calls at all.
    const client2 = humanizeStubClient()
    const rerunResult = await executeRunBatch(firestore, runId, { ...EXECUTE_OPTIONS, client: client2 })
    expect(rerunResult.processed).toBe(0)
    expect(rerunResult.stage).toBe('idle')
    expect((client2.chat.completions.create as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0)

    const jobsAfterResume = await listJobsForRun(firestore, runId)
    expect(jobsAfterResume).toHaveLength(jobs.length)
    const attemptsAfterResume = await listRepairAttemptsForRun(firestore, runId, 'A2H-06')
    expect(attemptsAfterResume).toHaveLength(2)
    expect(attemptsAfterResume.map(a => a.id).sort()).toEqual(grammarAttempts.map(a => a.id).sort())
  })
})

// Phase 4: the experimental trial layer (A2H-07/11/14/15) — end-to-end
// through the SAME executeRunBatch engine every earlier phase uses, proving
// the "do not create six separate execution architectures" constraint holds
// in practice, not just in the module boundaries. Also exercises A2H-16
// (via the ordinary DETERMINISTIC_EVALUATORS/test_evaluation path, with a
// claim_relationship fixture) and A2H-17 (pure aggregation over whatever
// telemetry the run above produced) against the same run.
describe('dry-run acceptance (Phase 4): experimental trials + A2H-16 + A2H-17', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('executes A2H-07/11/14/15 trials, persists them, computes reports, and never double-enqueues or re-calls the model on resume', async () => {
    const fetchMock = vi.fn().mockImplementation(() => jsonResponse(200, { classification: 'ai', class_probabilities: { human: 0.05, ai: 0.9, mixed: 0.05 } }))
    vi.stubGlobal('fetch', fetchMock)

    const { firestore } = makeFirestore()
    const projectId = await buildFrozenCorpus(firestore, { domains: ['general'], topicsPerDomain: 2, lengths: [100] })
    const topics = await listTopics(firestore, projectId)
    const sourceA = await getSource(firestore, projectId, topics[0]!.id, 100)
    const sourceB = await getSource(firestore, projectId, topics[1]!.id, 100)

    const fixtureSet = await createFixtureSet(firestore, { corpusProjectId: projectId, name: 'Claim Fixtures' })
    await createFixture(firestore, {
      fixtureSetId: fixtureSet.id, sourceId: sourceA!.id, type: 'claim_relationship',
      expected: { category: 'causal', sourceText: 'irrelevant claim text never present in the stub output', relation: 'causes', approvedEquivalentForms: [], knownCorruptions: [] },
    })
    const { result: fixtureResult } = await lockFixtureSet(firestore, fixtureSet.id)
    expect(fixtureResult.ok).toBe(true)

    const run = await createRun(firestore, { corpusProjectId: projectId, name: 'Phase 4 Run', modelProvider: 'openai', model: 'gpt-4o-mini' })
    await updateRunDraft(firestore, run.id, {
      intensities: [5],
      enabledTests: ['A2H-07', 'A2H-11', 'A2H-14', 'A2H-15', 'A2H-16'],
      fixtureSetId: fixtureSet.id,
      experimentConfig: {
        repeatability: { repeatCount: 2, sourceSampleSize: null, intensities: [5] },
        styleTone: { contrasts: [{ id: 'academic-vs-casual', label: 'Academic → Casual', left: { tone: 'academic' }, right: { tone: 'casual' }, expectedDirections: { contractionRate: 'higher_right' } }], sourceSampleSize: null },
        genreAudience: { contrasts: [{ id: 'patient-vs-research', label: 'Patient → Research', domain: 'general', left: { genre: 'patient_instructions' }, right: { genre: 'research_paper' }, expectedDirections: { readability: 'higher_left' } }], sourceSampleSize: null },
        candidateSelection: { intensities: [5], sourceSampleSize: null },
      },
    })

    const { result } = await validateRun(firestore, run.id, { hasModelConfig: true, hasDetectorConfig: true })
    expect(result.ok).toBe(true)

    // Cohorts are frozen at validation time, before any job exists.
    const cohortA2H07 = await getExperimentCohort(firestore, run.id, 'A2H-07')
    const cohortA2H11 = await getExperimentCohort(firestore, run.id, 'A2H-11')
    expect(cohortA2H07?.sourceIds).toHaveLength(2)
    expect(cohortA2H11?.sourceIds).toHaveLength(2)
    expect(cohortA2H07?.samplingSeed).toBeTruthy()

    await startRun(firestore, run.id)
    const client = humanizeStubClient()
    await runToCompletion(firestore, run.id, client)

    const finalRun = await getRun(firestore, run.id)
    expect(finalRun?.status).toBe('completed')

    const jobs = await listJobsForRun(firestore, run.id)
    const trialJobs = jobs.filter(j => j.stage === 'experimental_trial')
    // A2H-07: 2 sources x 1 intensity x 2 repeats = 4
    // A2H-11: 2 sources x 1 contrast x 2 sides = 4
    // A2H-14: 2 sources x 1 contrast x 2 sides = 4
    // A2H-15: 2 sources x 1 intensity x 2 arms = 4
    expect(trialJobs).toHaveLength(16)
    expect(trialJobs.every(j => j.status === 'completed')).toBe(true)

    const allTrials = await listTrialsForRun(firestore, run.id)
    expect(allTrials).toHaveLength(16)
    expect(allTrials.every(t => t.status === 'success')).toBe(true)

    const a2h07Report = await getA2H07Report(firestore, run.id)
    expect(a2h07Report.conditionsEvaluated).toBe(2)
    expect(a2h07Report.repeatsPerCondition).toBe(2)
    expect(a2h07Report.conditions.every(c => c.uniqueOutputCount >= 1)).toBe(true)

    const a2h11Report = await getA2H11Report(firestore, run.id, (await getRun(firestore, run.id))!.experimentConfig!.styleTone!.contrasts)
    expect(a2h11Report.pairs).toHaveLength(2)
    expect(a2h11Report.contrasts[0]?.n).toBe(2)

    const a2h14Report = await getA2H14Report(firestore, run.id, (await getRun(firestore, run.id))!.experimentConfig!.genreAudience!.contrasts)
    expect(a2h14Report.pairs).toHaveLength(2)

    const sourcesById = new Map([sourceA!, sourceB!].map(s => [s.id, s]))
    const a2h15Report = await getA2H15Report(firestore, run.id, (await getRun(firestore, run.id))!, sourcesById)
    expect(a2h15Report.pairs).toHaveLength(2)
    expect(a2h15Report.overall.n).toBe(2)

    // A2H-16 rides the ordinary output-scoped test_evaluation path — a
    // claim_relationship fixture whose sourceText never appears in the
    // stub's fixed rewrite classifies as 'uncertain', not fabricated as
    // preserved or corrupted.
    const a2h16Results = await listTestResultsForRun(firestore, run.id, 'A2H-16')
    expect(a2h16Results).toHaveLength(2) // 2 sources x 1 intensity
    const a2h16ForSourceA = a2h16Results.find(r => r.sourceId === sourceA!.id)
    const measurementsA = a2h16ForSourceA?.measurements as { eligible: boolean; results: Array<{ status: string }> }
    expect(measurementsA.eligible).toBe(true)
    expect(measurementsA.results[0]?.status).toBe('uncertain')
    const a2h16ForSourceB = a2h16Results.find(r => r.sourceId === sourceB!.id)
    const measurementsB = a2h16ForSourceB?.measurements as { eligible: boolean }
    expect(measurementsB.eligible).toBe(false) // sourceB has no claim_relationship fixture

    const a2h17Report = await getA2H17Report(firestore, run.id)
    expect(a2h17Report.byOperationType['trial_a2h07']?.n).toBe(4)
    expect(a2h17Report.byOperationType['trial_a2h11']?.n).toBe(4)
    expect(a2h17Report.byOperationType['trial_a2h14']?.n).toBe(4)
    expect(a2h17Report.byOperationType['trial_a2h15']?.n).toBe(4)
    expect(a2h17Report.byOperationType['humanite_transform']?.n).toBe(2)
    expect(a2h17Report.overall.n).toBe(18)
    expect(a2h17Report.overall.failures.count).toBe(0)

    // "Final Polish" patch §17/§29: this deployment only instruments the
    // PRIMARY generation call, never the full pipeline (judge/document-
    // context/consistency/repair calls) — every real record must say so
    // explicitly, never silently default to 'complete', and a stub client
    // reporting no cost data must leave estimatedCostUsd null, never a
    // fabricated 0.
    const operationRecords = await collectOperationRecords(firestore, run.id)
    expect(operationRecords.length).toBe(a2h17Report.overall.n)
    expect(operationRecords.every(r => r.telemetryScope === 'primary_generation_only')).toBe(true)
    expect(operationRecords.every(r => r.estimatedCostUsd === null)).toBe(true)

    // Idempotency (§37, critical): re-running must not enqueue a single new
    // job, duplicate a single trial, or make one more model call.
    const callsBeforeResume = (client.chat.completions.create as ReturnType<typeof vi.fn>).mock.calls.length
    const fetchCallsBeforeResume = fetchMock.mock.calls.length
    const client2 = humanizeStubClient()
    const rerunResult = await executeRunBatch(firestore, run.id, { ...EXECUTE_OPTIONS, client: client2 })
    expect(rerunResult.processed).toBe(0)
    expect(rerunResult.stage).toBe('idle')
    expect((client2.chat.completions.create as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0)
    expect((client.chat.completions.create as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBeforeResume)
    expect(fetchMock.mock.calls.length).toBe(fetchCallsBeforeResume)

    const trialsAfterResume = await listTrialsForRun(firestore, run.id)
    expect(trialsAfterResume).toHaveLength(16)
    expect(trialsAfterResume.map(t => t.id).sort()).toEqual(allTrials.map(t => t.id).sort())
  })
})

// "Final Polish" patch, §24-25: a run snapshots its model/provider at
// validation time, but nothing previously stopped a LATER /execute call from
// resolving the admin's now-different Settings and silently claiming/paying
// for the run's remaining jobs under a different configuration while the
// run's own metadata kept claiming the original one. §7's
// assertExecutionConfigMatchesRun must refuse this outright, before touching
// recovery, job claiming, or the paid client at all.
describe('model/provider drift protection (§24-25)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('throws ExecutionConfigMismatchError and claims/executes nothing when the resolved model differs from the run snapshot', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => jsonResponse(200, { classification: 'ai', class_probabilities: { human: 0.05, ai: 0.9, mixed: 0.05 } })))
    const { firestore } = makeFirestore()
    const projectId = await buildFrozenCorpus(firestore, { domains: ['general'], topicsPerDomain: 1, lengths: [100] })
    const run = await createRun(firestore, { corpusProjectId: projectId, name: 'Drift Run', modelProvider: 'openai', model: 'gpt-4o-mini' })
    await updateRunDraft(firestore, run.id, { intensities: [5, 8] })
    const { result } = await validateRun(firestore, run.id, { hasModelConfig: true, hasDetectorConfig: true })
    expect(result.ok).toBe(true)
    await startRun(firestore, run.id)

    const client = humanizeStubClient()
    await expect(executeRunBatch(firestore, run.id, { ...EXECUTE_OPTIONS, model: 'gpt-4o', client }))
      .rejects.toThrow(ExecutionConfigMismatchError)
    expect((client.chat.completions.create as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0)

    const jobs = await listJobsForRun(firestore, run.id)
    expect(jobs.every(j => j.status === 'queued')).toBe(true)
    expect(jobs.filter(j => j.status === 'running')).toHaveLength(0)
    // The run's own snapshot must never be silently rewritten to the new
    // configuration just because a mismatched execute call was attempted.
    const unchangedRun = await getRun(firestore, run.id)
    expect(unchangedRun?.model).toBe('gpt-4o-mini')
    expect(unchangedRun?.status).toBe('running')
  })

  it('throws ExecutionConfigMismatchError and claims/executes nothing when the resolved provider differs from the run snapshot', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => jsonResponse(200, { classification: 'ai', class_probabilities: { human: 0.05, ai: 0.9, mixed: 0.05 } })))
    const { firestore } = makeFirestore()
    const projectId = await buildFrozenCorpus(firestore, { domains: ['general'], topicsPerDomain: 1, lengths: [100] })
    const run = await createRun(firestore, { corpusProjectId: projectId, name: 'Drift Run 2', modelProvider: 'openai', model: 'gpt-4o-mini' })
    await updateRunDraft(firestore, run.id, { intensities: [5, 8] })
    const { result } = await validateRun(firestore, run.id, { hasModelConfig: true, hasDetectorConfig: true })
    expect(result.ok).toBe(true)
    await startRun(firestore, run.id)

    const client = humanizeStubClient()
    await expect(executeRunBatch(firestore, run.id, { ...EXECUTE_OPTIONS, modelProvider: 'https://byok.example.com/v1', client }))
      .rejects.toThrow(ExecutionConfigMismatchError)
    expect((client.chat.completions.create as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0)

    const jobs = await listJobsForRun(firestore, run.id)
    expect(jobs.filter(j => j.status === 'running')).toHaveLength(0)
  })

  it('a run paused and resumed under a CHANGED Settings configuration still refuses to execute until the original config is restored', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => jsonResponse(200, { classification: 'ai', class_probabilities: { human: 0.05, ai: 0.9, mixed: 0.05 } })))
    const { firestore } = makeFirestore()
    const projectId = await buildFrozenCorpus(firestore, { domains: ['general'], topicsPerDomain: 2, lengths: [100] })
    const run = await createRun(firestore, { corpusProjectId: projectId, name: 'Resume Drift Run', modelProvider: 'openai', model: 'gpt-4o-mini' })
    await updateRunDraft(firestore, run.id, { intensities: [3, 6] })
    await validateRun(firestore, run.id, { hasModelConfig: true, hasDetectorConfig: true })
    await startRun(firestore, run.id)

    // Complete some real work under the ORIGINAL configuration first.
    const client = humanizeStubClient()
    await executeRunBatch(firestore, run.id, { ...EXECUTE_OPTIONS, client, maxJobsPerStage: 1 })
    await pauseRun(firestore, run.id)
    const progressAtPause = await getRunProgress(firestore, run.id)
    expect(progressAtPause.baselinesCompleted).toBeGreaterThan(0)

    // Admin changes Settings to a different model, then resumes the run —
    // the resume itself only flips status; it does not touch model/provider.
    await resumeRun(firestore, run.id)
    const resumedRun = await getRun(firestore, run.id)
    expect(resumedRun?.status).toBe('running')
    expect(resumedRun?.model).toBe('gpt-4o-mini') // unchanged by resume

    // Attempting to continue execution under the NEW (mismatched) Settings
    // must refuse outright — no new work claimed, no paid calls made, and
    // already-completed evidence from before the pause is left untouched.
    const newModelClient = humanizeStubClient()
    await expect(executeRunBatch(firestore, run.id, { ...EXECUTE_OPTIONS, model: 'gpt-4o', client: newModelClient }))
      .rejects.toThrow(ExecutionConfigMismatchError)
    expect((newModelClient.chat.completions.create as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0)
    const progressAfterBlockedAttempt = await getRunProgress(firestore, run.id)
    expect(progressAfterBlockedAttempt).toEqual(progressAtPause)

    // Restoring the ORIGINAL configuration lets the run resume normally and
    // finish to completion, with the already-completed baseline preserved.
    await runToCompletion(firestore, run.id, client)
    const finalRun = await getRun(firestore, run.id)
    expect(finalRun?.status).toBe('completed')
    const finalProgress = await getRunProgress(firestore, run.id)
    expect(finalProgress.baselinesCompleted).toBe(2)
  })
})

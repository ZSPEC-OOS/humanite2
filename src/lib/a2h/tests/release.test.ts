import { describe, it, expect, vi, afterEach } from 'vitest'
import type { Firestore } from 'firebase-admin/firestore'
import type OpenAI from 'openai'
import type { Domain } from '@/lib/style/types'
import { executeRunBatch } from '../execution'
import { createRun, updateRunDraft, validateRun, startRun, getRun, maybeCompleteRun } from '../runs'
import { createCorpusProject, updateProjectDraft, lockBlueprint, freezeCorpusProject, getCorpusManifest } from '../corpusProject'
import { createTopic, listTopics } from '../topics'
import type { CreateTopicInput } from '../topics'
import { generateSource, freezeSource } from '../corpus'
import { listJobsForRun } from '../jobs'
import { listOutputsForRun } from '../outputs'
import { A2H_COLLECTIONS } from '../types'
import {
  validateReleaseReadiness, createRelease, getRelease, getReleaseForRun, verifyReleaseIntegrity, DEFAULT_RELEASE_VERSION,
} from '../release'

// Same per-collection-map fake used by jobs.test.ts/execution.test.ts —
// release.ts drives real runs through executeRunBatch (which needs
// runTransaction for claimJob), so this fake needs the same transaction shim.
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
  // Echoes back whatever model was actually requested — matching a real
  // provider's completion.model response field, which is what
  // outputs.model ultimately records (see runHumaniteDocument/
  // humanizeChunk). A hardcoded literal here would silently disagree with
  // whatever model the run/EXECUTE_OPTIONS actually requested, and the
  // "Final Polish" patch's release-consistency check (§13) would then
  // correctly flag every output as mixed-model — not a bug in that check.
  const chatCreate = vi.fn().mockImplementation(async (args: { model: string; response_format?: { type?: string } }) => {
    if (args.response_format?.type === 'json_object') {
      return { model: args.model, choices: [{ message: { content: '{"entailment_probability": 0.9, "issues": []}' }, finish_reason: 'stop' }] }
    }
    return {
      model: args.model,
      choices: [{ message: { content: 'A humanized rewrite of the source text, produced for release-layer test purposes only.' }, finish_reason: 'stop' }],
      usage: { total_tokens: 500 },
    }
  })
  return { chat: { completions: { create: chatCreate } } } as unknown as OpenAI
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

async function buildFrozenCorpus(firestore: Firestore, opts: { domains: Domain[]; topicsPerDomain: number; lengths: number[] }): Promise<string> {
  const project = await createCorpusProject(firestore, { name: 'Release Test Corpus' })
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

async function runToCompletion(firestore: Firestore, runId: string, client: OpenAI, maxIterations = 200): Promise<void> {
  for (let i = 0; i < maxIterations; i++) {
    const run = await getRun(firestore, runId)
    if (!run || run.status !== 'running') return
    await executeRunBatch(firestore, runId, { ...EXECUTE_OPTIONS, client, maxJobsPerStage: 25 })
  }
  throw new Error(`runToCompletion did not finish within ${maxIterations} iterations`)
}

// Small but non-trivial: 1 domain, 2 topics, 1 length, 2 intensities — 2
// sources x 2 intensities = 4 outputs, with the default A2H-01/02/03 tests
// enabled (A2H-02 requires >=2 intensities).
async function buildCompletedRun(firestore: Firestore): Promise<{ runId: string; corpusProjectId: string }> {
  vi.stubGlobal('fetch', vi.fn().mockImplementation(() => jsonResponse(200, {
    classification: 'ai',
    class_probabilities: { human: 0.05, ai: 0.9, mixed: 0.05 },
  })))
  const corpusProjectId = await buildFrozenCorpus(firestore, { domains: ['general'], topicsPerDomain: 2, lengths: [100] })
  const run = await createRun(firestore, { corpusProjectId, name: 'Release Test Run', modelProvider: 'openai', model: 'gpt-4o-mini' })
  await updateRunDraft(firestore, run.id, { intensities: [3, 6] })
  const { result } = await validateRun(firestore, run.id, { hasModelConfig: true, hasDetectorConfig: true })
  expect(result.ok).toBe(true)
  await startRun(firestore, run.id)
  await runToCompletion(firestore, run.id, humanizeStubClient())
  const finalRun = await getRun(firestore, run.id)
  expect(finalRun?.status).toBe('completed')
  return { runId: run.id, corpusProjectId }
}

describe('validateReleaseReadiness', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fails for a run that does not exist', async () => {
    const { firestore } = makeFirestore()
    const result = await validateReleaseReadiness(firestore, 'nonexistent-run')
    expect(result.ok).toBe(false)
    expect(result.errors.some(e => /not found/i.test(e))).toBe(true)
  })

  it('fails while the run is still running', async () => {
    const { firestore } = makeFirestore()
    const corpusProjectId = await buildFrozenCorpus(firestore, { domains: ['general'], topicsPerDomain: 1, lengths: [100] })
    const run = await createRun(firestore, { corpusProjectId, name: 'Run', modelProvider: 'openai', model: 'gpt-4o-mini' })
    await validateRun(firestore, run.id, { hasModelConfig: true, hasDetectorConfig: true })
    await startRun(firestore, run.id)

    const result = await validateReleaseReadiness(firestore, run.id)
    expect(result.ok).toBe(false)
    expect(result.errors.some(e => /must be 'completed'/i.test(e))).toBe(true)
  })

  it("fails for a needs_attention run, with a hint to retry failed jobs first", async () => {
    const { firestore } = makeFirestore()
    const corpusProjectId = await buildFrozenCorpus(firestore, { domains: ['general'], topicsPerDomain: 1, lengths: [100] })
    const run = await createRun(firestore, { corpusProjectId, name: 'Run', modelProvider: 'openai', model: 'gpt-4o-mini' })
    await validateRun(firestore, run.id, { hasModelConfig: true, hasDetectorConfig: true })
    await startRun(firestore, run.id)
    const jobs = await listJobsForRun(firestore, run.id)
    for (const [i, job] of jobs.entries()) {
      await firestore.collection('a2hBenchmarkJobs').doc(job.id).update({
        status: i === 0 ? 'failed' : 'completed',
        completedAt: new Date().toISOString(),
      })
    }
    await maybeCompleteRun(firestore, run.id)
    expect((await getRun(firestore, run.id))?.status).toBe('needs_attention')

    const result = await validateReleaseReadiness(firestore, run.id)
    expect(result.ok).toBe(false)
    expect(result.errors.some(e => /retry its failed jobs/i.test(e))).toBe(true)
  })

  it('passes once the run completes cleanly with full test coverage', async () => {
    const { firestore } = makeFirestore()
    const { runId } = await buildCompletedRun(firestore)

    const result = await validateReleaseReadiness(firestore, runId)
    expect(result.errors).toEqual([])
    expect(result.ok).toBe(true)
  })

  it("fails if the corpus manifest has changed since the run's own snapshot", async () => {
    const { firestore } = makeFirestore()
    const { runId, corpusProjectId } = await buildCompletedRun(firestore)

    const manifest = await getCorpusManifest(firestore, corpusProjectId)
    await firestore.collection(A2H_COLLECTIONS.manifests).doc(corpusProjectId).update({ ...manifest, manifestHash: 'tampered-hash' })

    const result = await validateReleaseReadiness(firestore, runId)
    expect(result.ok).toBe(false)
    expect(result.errors.some(e => /manifest hash no longer matches/i.test(e))).toBe(true)
  })

  it('fails when a job is still queued (e.g. an out-of-band partial run)', async () => {
    const { firestore } = makeFirestore()
    const { runId } = await buildCompletedRun(firestore)

    // Simulate a straggler queued job that somehow survived to a
    // 'completed' run — the readiness check must not simply trust run.status.
    await firestore.collection('a2hBenchmarkJobs').doc('stray-job').set({
      id: 'stray-job', runId, stage: 'humanite_transform', status: 'queued', benchmarkCode: null,
    })

    const result = await validateReleaseReadiness(firestore, runId)
    expect(result.ok).toBe(false)
    expect(result.errors.some(e => /still queued\/running\/retrying/i.test(e))).toBe(true)
  })
})

describe('createRelease', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('refuses to freeze a release that fails readiness, and creates nothing', async () => {
    const { firestore } = makeFirestore()
    const corpusProjectId = await buildFrozenCorpus(firestore, { domains: ['general'], topicsPerDomain: 1, lengths: [100] })
    const run = await createRun(firestore, { corpusProjectId, name: 'Run', modelProvider: 'openai', model: 'gpt-4o-mini' })
    await validateRun(firestore, run.id, { hasModelConfig: true, hasDetectorConfig: true })
    await startRun(firestore, run.id) // still running — not eligible

    const result = await createRelease(firestore, run.id)
    expect(result.ok).toBe(false)
    expect(result.release).toBeNull()
    expect(result.errors.length).toBeGreaterThan(0)
    expect(await getReleaseForRun(firestore, run.id)).toBeNull()
    expect((await getRun(firestore, run.id))?.releasedAt).toBeNull()
  })

  it('freezes a complete, internally-consistent release for a completed run', async () => {
    const { firestore } = makeFirestore()
    const { runId } = await buildCompletedRun(firestore)

    const result = await createRelease(firestore, runId)
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
    const release = result.release!
    expect(release.runId).toBe(runId)
    expect(release.releaseVersion).toBe(DEFAULT_RELEASE_VERSION)
    expect(release.primaryOutputCount).toBe(4) // 2 sources x 2 intensities
    expect(release.excludedRecordCount).toBe(0)
    expect(release.failedJobCount).toBe(0)
    expect(release.testResultCount).toBeGreaterThan(0)
    expect(release.outputHashes['outputs']).toHaveLength(64)
    expect(release.resultHashes['testResults']).toHaveLength(64)
    expect(release.releaseHash).toHaveLength(64)
    expect(release.aggregateSnapshot['A2H-01']).toBeDefined()
    expect(release.aggregateSnapshot['A2H-02']).toBeDefined()
    expect(release.aggregateSnapshot['A2H-03']).toBeDefined()

    // Persisted and retrievable both ways.
    expect(await getRelease(firestore, release.id)).toEqual(release)
    expect(await getReleaseForRun(firestore, runId)).toEqual(release)

    // The run itself is now flagged released.
    const updatedRun = await getRun(firestore, runId)
    expect(updatedRun?.releasedAt).toBe(release.releasedAt)
  })

  it('refuses a second release for an already-released run', async () => {
    const { firestore } = makeFirestore()
    const { runId } = await buildCompletedRun(firestore)
    const first = await createRelease(firestore, runId)
    expect(first.ok).toBe(true)

    const second = await createRelease(firestore, runId)
    expect(second.ok).toBe(false)
    expect(second.release).toBeNull()
    expect(second.errors.some(e => /already has a release/i.test(e))).toBe(true)

    // Still exactly one release document for this run.
    const outputsRelease = await getReleaseForRun(firestore, runId)
    expect(outputsRelease?.id).toBe(first.release!.id)
  })

  it('a released run refuses forceOverwrite on its outputs (regeneration is permanently blocked)', async () => {
    const { firestore } = makeFirestore()
    const { runId } = await buildCompletedRun(firestore)
    await createRelease(firestore, runId)

    const outputs = await listOutputsForRun(firestore, runId)
    expect(outputs.length).toBeGreaterThan(0)
    // Confirms the release actually stamped releasedAt — the field
    // transformSource's forceOverwrite guard checks (exercised directly in
    // outputs.test.ts's own released-run test).
    const run = await getRun(firestore, runId)
    expect(run?.releasedAt).not.toBeNull()
  })
})

describe('verifyReleaseIntegrity', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reports not found for an unknown release id', async () => {
    const { firestore } = makeFirestore()
    const result = await verifyReleaseIntegrity(firestore, 'nonexistent-release')
    expect(result.ok).toBe(false)
    expect(result.errors.some(e => /not found/i.test(e))).toBe(true)
  })

  it('passes immediately after a release is frozen', async () => {
    const { firestore } = makeFirestore()
    const { runId } = await buildCompletedRun(firestore)
    const { release } = await createRelease(firestore, runId)

    const result = await verifyReleaseIntegrity(firestore, release!.id)
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('detects a mutated output record as an integrity failure', async () => {
    const { firestore } = makeFirestore()
    const { runId } = await buildCompletedRun(firestore)
    const { release } = await createRelease(firestore, runId)

    const outputs = await listOutputsForRun(firestore, runId)
    const [firstOutput] = outputs
    await firestore.collection(A2H_COLLECTIONS.outputs).doc(firstOutput!.id).update({ outputText: 'tampered post-release content' })

    const result = await verifyReleaseIntegrity(firestore, release!.id)
    expect(result.ok).toBe(false)
    expect(result.errors.some(e => /outputs hash no longer matches/i.test(e))).toBe(true)
  })

  // "Final Polish" patch, §12/§27: resultHashes.detectorResults is hashed
  // from listDetectorEvidenceForRun's LOGICAL dependency set (baselines the
  // cohort actually used + post-scores the outputs actually used), not a
  // runId-filtered query — so mutating OR deleting one of those detector
  // rows must be caught exactly like a mutated output/test-result would be.
  it('detects a mutated detector-evidence row (a baseline) as an integrity failure', async () => {
    const { firestore } = makeFirestore()
    const { runId } = await buildCompletedRun(firestore)
    const { release } = await createRelease(firestore, runId)

    const snap = await firestore.collection(A2H_COLLECTIONS.detectorResults).get()
    const baselineRow = snap.docs.map(d => d.data() as { id: string; stage?: string }).find(d => d.stage === 'baseline')
    expect(baselineRow).toBeDefined()
    await firestore.collection(A2H_COLLECTIONS.detectorResults).doc(baselineRow!.id).update({ aiProbability: 0.01 })

    const result = await verifyReleaseIntegrity(firestore, release!.id)
    expect(result.ok).toBe(false)
    expect(result.errors.some(e => /detector.*results.*hash no longer matches/i.test(e))).toBe(true)
  })

  it('detects a DELETED detector-evidence row as an integrity failure, not a silent pass', async () => {
    const { firestore } = makeFirestore()
    const { runId } = await buildCompletedRun(firestore)
    const { release } = await createRelease(firestore, runId)

    const snap = await firestore.collection(A2H_COLLECTIONS.detectorResults).get()
    const postScoreRow = snap.docs.map(d => d.data() as { id: string; stage?: string }).find(d => d.stage === 'post_transform')
    expect(postScoreRow).toBeDefined()
    await firestore.collection(A2H_COLLECTIONS.detectorResults).doc(postScoreRow!.id).delete()

    const result = await verifyReleaseIntegrity(firestore, release!.id)
    expect(result.ok).toBe(false)
    expect(result.errors.some(e => /detector.*results.*hash no longer matches/i.test(e))).toBe(true)
  })
})

// "Final Polish" patch, §13/§28: before release, every successful output
// must actually have been produced under the run's own frozen model/provider
// snapshot — a mixed-model or mixed-provider run (e.g. Settings drifted mid-
// run before §7's guard existed, or a legacy row was hand-edited) must never
// be released as if it were one internally-consistent configuration.
describe('validateReleaseReadiness — output configuration consistency (§13/§28)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fails when a successful output was generated under a DIFFERENT model than the run snapshot', async () => {
    const { firestore } = makeFirestore()
    const { runId } = await buildCompletedRun(firestore)

    const outputs = await listOutputsForRun(firestore, runId)
    const [firstOutput] = outputs
    await firestore.collection(A2H_COLLECTIONS.outputs).doc(firstOutput!.id).update({ model: 'gpt-3.5-turbo' })

    const result = await validateReleaseReadiness(firestore, runId)
    expect(result.ok).toBe(false)
    expect(result.errors.some(e => /different model than this run's snapshot/i.test(e))).toBe(true)
  })

  it('fails when a successful output was generated under a DIFFERENT provider than the run snapshot', async () => {
    const { firestore } = makeFirestore()
    const { runId } = await buildCompletedRun(firestore)

    const outputs = await listOutputsForRun(firestore, runId)
    const [firstOutput] = outputs
    await firestore.collection(A2H_COLLECTIONS.outputs).doc(firstOutput!.id).update({ modelProvider: 'https://byok.example.com/v1' })

    const result = await validateReleaseReadiness(firestore, runId)
    expect(result.ok).toBe(false)
    expect(result.errors.some(e => /different provider than this run's snapshot/i.test(e))).toBe(true)
  })

  it('tolerates a provider-versioned model suffix (e.g. gpt-4o-mini-2024-07-18) without flagging it as mixed-model', async () => {
    const { firestore } = makeFirestore()
    const { runId } = await buildCompletedRun(firestore)

    const outputs = await listOutputsForRun(firestore, runId)
    const [firstOutput] = outputs
    await firestore.collection(A2H_COLLECTIONS.outputs).doc(firstOutput!.id).update({ model: 'gpt-4o-mini-2024-07-18' })

    const result = await validateReleaseReadiness(firestore, runId)
    expect(result.errors.some(e => /different model than this run's snapshot/i.test(e))).toBe(false)
  })

  it("fails when a successful output's appliedIntensity is inconsistent with the current effective-intensity policy", async () => {
    const { firestore } = makeFirestore()
    const { runId } = await buildCompletedRun(firestore)

    const outputs = await listOutputsForRun(firestore, runId)
    const [firstOutput] = outputs
    await firestore.collection(A2H_COLLECTIONS.outputs).doc(firstOutput!.id).update({ appliedIntensity: 999, intensityCapped: true })

    const result = await validateReleaseReadiness(firestore, runId)
    expect(result.ok).toBe(false)
    expect(result.errors.some(e => /appliedIntensity\/intensityCapped value inconsistent/i.test(e))).toBe(true)
  })
})

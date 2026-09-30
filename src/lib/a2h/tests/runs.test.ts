import { describe, it, expect } from 'vitest'
import type { Firestore } from 'firebase-admin/firestore'
import type OpenAI from 'openai'
import type { Domain } from '@/lib/style/types'
import {
  createRun, getRun, listRunsForProject, updateRunDraft, checkRunValidity, validateRun,
  listRunSources, startRun, pauseRun, resumeRun, cancelRun, getRunProgress,
} from '../runs'
import { listJobsForRun } from '../jobs'
import { createCorpusProject, updateProjectDraft, lockBlueprint, freezeCorpusProject } from '../corpusProject'
import { createTopic, listTopics } from '../topics'
import type { CreateTopicInput } from '../topics'
import { generateSource, freezeSource } from '../corpus'

// A single fake supporting every collection this pipeline touches —
// corpus project/topics/sources/manifest, plus runs/run-sources/jobs — the
// same per-collection-map pattern corpusProject.test.ts uses.
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

function stubClient(content: string): OpenAI {
  return {
    chat: { completions: { create: async () => ({ choices: [{ message: { content } }] }) } },
  } as unknown as OpenAI
}
function words(n: number): string {
  return Array(n).fill('word').join(' ')
}

// Builds a small, fully frozen corpus (domains x topicsPerDomain topics,
// each generated at every length in `lengths`, all frozen, manifest
// written) — the minimum precondition createRun requires.
async function buildFrozenCorpus(firestore: Firestore, opts: { domains: Domain[]; topicsPerDomain: number; lengths: number[] }): Promise<string> {
  const project = await createCorpusProject(firestore, { name: 'Test Corpus' })
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
        client: stubClient(words(targetWords)), model: 'stub', providerLabel: 'openai',
      })
      await freezeSource(firestore, project.id, topic.id, targetWords)
    }
  }
  await freezeCorpusProject(firestore, project.id)
  return project.id
}

const OK_OPTIONS = { hasModelConfig: true, hasDetectorConfig: true }

describe('createRun', () => {
  it('rejects against a draft corpus', async () => {
    const { firestore } = makeFirestore()
    const project = await createCorpusProject(firestore, { name: 'Draft corpus' })
    await expect(createRun(firestore, { corpusProjectId: project.id, name: 'Run', modelProvider: 'openai', model: 'gpt-4o-mini' }))
      .rejects.toThrow(/not frozen/i)
  })

  it('rejects against a generating (not yet frozen) corpus', async () => {
    const { firestore } = makeFirestore()
    const project = await createCorpusProject(firestore, { name: 'Generating corpus' })
    await updateProjectDraft(firestore, project.id, { domains: ['general'], topicCountDefault: 1, lengthLadder: [100] })
    await createTopic(firestore, {
      corpusProjectId: project.id, domainId: 'general', topicNumber: 1, title: 't', description: 'd',
      intendedAudience: 'a', writingType: 'w', coreConcepts: ['c'], generationPromptVersion: 'GEN-V001',
    } as CreateTopicInput)
    await lockBlueprint(firestore, project.id)
    const [topic] = await listTopics(firestore, project.id)
    await generateSource(firestore, {
      corpusProjectId: project.id, topic: topic!, targetWords: 100, temperature: null,
      client: stubClient(words(100)), model: 'stub', providerLabel: 'openai',
    })
    // Not frozen — still 'generating'.
    await expect(createRun(firestore, { corpusProjectId: project.id, name: 'Run', modelProvider: 'openai', model: 'gpt-4o-mini' }))
      .rejects.toThrow(/not frozen/i)
  })

  it('creates a run against a frozen corpus with a valid manifest, defaulting to the full cohort', async () => {
    const { firestore } = makeFirestore()
    const projectId = await buildFrozenCorpus(firestore, { domains: ['general', 'legal'], topicsPerDomain: 2, lengths: [100, 200] })

    const run = await createRun(firestore, { corpusProjectId: projectId, name: 'Run 1', modelProvider: 'openai', model: 'gpt-4o-mini' })
    expect(run.status).toBe('draft')
    expect(run.corpusProjectId).toBe(projectId)
    expect(run.selectedDomains.sort()).toEqual(['general', 'legal'])
    expect(run.selectedTopicIds).toHaveLength(4)
    expect(run.selectedLengths).toEqual([100, 200])
    expect(run.intensities).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(run.enabledTests).toEqual(['A2H-01', 'A2H-02', 'A2H-03'])
    expect(run.concurrency).toBeGreaterThan(0)
    expect(run.corpusManifestHash).toHaveLength(64)
    expect(run.humaniteVersion).toBeTruthy()
    expect(run.gitCommit).toBeTruthy()
  })

  it('round-trips through getRun and appears in listRunsForProject', async () => {
    const { firestore } = makeFirestore()
    const projectId = await buildFrozenCorpus(firestore, { domains: ['general'], topicsPerDomain: 1, lengths: [100] })
    const run = await createRun(firestore, { corpusProjectId: projectId, name: 'Run 1', modelProvider: 'openai', model: 'gpt-4o-mini' })
    expect(await getRun(firestore, run.id)).toEqual(run)
    expect((await listRunsForProject(firestore, projectId)).map(r => r.id)).toContain(run.id)
  })

  it('two runs can independently reference the same frozen corpus', async () => {
    const { firestore } = makeFirestore()
    const projectId = await buildFrozenCorpus(firestore, { domains: ['general'], topicsPerDomain: 1, lengths: [100] })
    const runA = await createRun(firestore, { corpusProjectId: projectId, name: 'Run A', modelProvider: 'openai', model: 'gpt-4o-mini' })
    const runB = await createRun(firestore, { corpusProjectId: projectId, name: 'Run B', modelProvider: 'openai', model: 'gpt-4o-mini' })
    expect(runA.id).not.toBe(runB.id)
    expect(runA.corpusProjectId).toBe(runB.corpusProjectId)
  })
})

describe('updateRunDraft', () => {
  it('allows reducing the cohort while draft — the dry-run use case', async () => {
    const { firestore } = makeFirestore()
    const projectId = await buildFrozenCorpus(firestore, { domains: ['general', 'legal'], topicsPerDomain: 2, lengths: [100, 200] })
    const run = await createRun(firestore, { corpusProjectId: projectId, name: 'Run 1', modelProvider: 'openai', model: 'gpt-4o-mini' })

    const generalTopics = (await listTopics(firestore, projectId, 'general')).map(t => t.id)
    const updated = await updateRunDraft(firestore, run.id, {
      selectedDomains: ['general'],
      selectedTopicIds: generalTopics,
      selectedLengths: [100],
      intensities: [2, 5, 8],
    })
    expect(updated.selectedDomains).toEqual(['general'])
    expect(updated.selectedTopicIds.sort()).toEqual(generalTopics.sort())
    expect(updated.selectedLengths).toEqual([100])
    expect(updated.intensities).toEqual([2, 5, 8])
  })

  it('rejects once the run is no longer draft', async () => {
    const { firestore } = makeFirestore()
    const projectId = await buildFrozenCorpus(firestore, { domains: ['general'], topicsPerDomain: 1, lengths: [100] })
    const run = await createRun(firestore, { corpusProjectId: projectId, name: 'Run 1', modelProvider: 'openai', model: 'gpt-4o-mini' })
    await validateRun(firestore, run.id, OK_OPTIONS)
    await expect(updateRunDraft(firestore, run.id, { name: 'New name' })).rejects.toThrow(/not draft/i)
  })

  it('rejects invalid intensity values', async () => {
    const { firestore } = makeFirestore()
    const projectId = await buildFrozenCorpus(firestore, { domains: ['general'], topicsPerDomain: 1, lengths: [100] })
    const run = await createRun(firestore, { corpusProjectId: projectId, name: 'Run 1', modelProvider: 'openai', model: 'gpt-4o-mini' })
    await expect(updateRunDraft(firestore, run.id, { intensities: [0, 5] })).rejects.toThrow(/integer 1-10/i)
    await expect(updateRunDraft(firestore, run.id, { intensities: [5, 11] })).rejects.toThrow(/integer 1-10/i)
  })
})

describe('checkRunValidity / validateRun', () => {
  it('passes for the default full-cohort configuration and snapshots the cohort', async () => {
    const { firestore } = makeFirestore()
    const projectId = await buildFrozenCorpus(firestore, { domains: ['general', 'legal'], topicsPerDomain: 2, lengths: [100, 200] })
    const run = await createRun(firestore, { corpusProjectId: projectId, name: 'Run 1', modelProvider: 'openai', model: 'gpt-4o-mini' })

    const { run: validated, result } = await validateRun(firestore, run.id, OK_OPTIONS)
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
    expect(validated.status).toBe('validated')
    expect(validated.validatedAt).not.toBeNull()

    const cohort = await listRunSources(firestore, run.id)
    expect(cohort).toHaveLength(4 * 2) // 4 topics x 2 lengths
    expect(cohort.every(c => c.runId === run.id && c.corpusProjectId === projectId)).toBe(true)
    expect(cohort.every(c => c.sourceSha256.length === 64)).toBe(true)
  })

  it('fails when a selected topic belongs to a domain that is not selected', async () => {
    const { firestore } = makeFirestore()
    const projectId = await buildFrozenCorpus(firestore, { domains: ['general', 'legal'], topicsPerDomain: 1, lengths: [100] })
    const run = await createRun(firestore, { corpusProjectId: projectId, name: 'Run 1', modelProvider: 'openai', model: 'gpt-4o-mini' })
    await updateRunDraft(firestore, run.id, { selectedDomains: ['general'] }) // selectedTopicIds still includes a legal topic

    const updatedRun = await getRun(firestore, run.id)
    const result = await checkRunValidity(firestore, updatedRun!, OK_OPTIONS)
    expect(result.ok).toBe(false)
    expect(result.errors.some(e => /not selected/i.test(e))).toBe(true)
  })

  it('requires at least 2 selected intensities when A2H-02 is enabled', async () => {
    const { firestore } = makeFirestore()
    const projectId = await buildFrozenCorpus(firestore, { domains: ['general'], topicsPerDomain: 1, lengths: [100] })
    const run = await createRun(firestore, { corpusProjectId: projectId, name: 'Run 1', modelProvider: 'openai', model: 'gpt-4o-mini' })
    await updateRunDraft(firestore, run.id, { intensities: [5] })

    const updatedRun = await getRun(firestore, run.id)
    const result = await checkRunValidity(firestore, updatedRun!, OK_OPTIONS)
    expect(result.ok).toBe(false)
    expect(result.errors.some(e => /A2H-02/.test(e))).toBe(true)
  })

  it('flags a missing GPTZero configuration', async () => {
    const { firestore } = makeFirestore()
    const projectId = await buildFrozenCorpus(firestore, { domains: ['general'], topicsPerDomain: 1, lengths: [100] })
    const run = await createRun(firestore, { corpusProjectId: projectId, name: 'Run 1', modelProvider: 'openai', model: 'gpt-4o-mini' })
    const result = await checkRunValidity(firestore, run, { hasModelConfig: true, hasDetectorConfig: false })
    expect(result.ok).toBe(false)
    expect(result.errors.some(e => /GPTZero/.test(e))).toBe(true)
  })

  it('flags a missing Humanite model configuration', async () => {
    const { firestore } = makeFirestore()
    const projectId = await buildFrozenCorpus(firestore, { domains: ['general'], topicsPerDomain: 1, lengths: [100] })
    const run = await createRun(firestore, { corpusProjectId: projectId, name: 'Run 1', modelProvider: 'openai', model: 'gpt-4o-mini' })
    const result = await checkRunValidity(firestore, run, { hasModelConfig: false, hasDetectorConfig: true })
    expect(result.ok).toBe(false)
    expect(result.errors.some(e => /model\/provider/i.test(e))).toBe(true)
  })

  it('does not mutate the run or leave a partial cohort when validation fails', async () => {
    const { firestore } = makeFirestore()
    const projectId = await buildFrozenCorpus(firestore, { domains: ['general'], topicsPerDomain: 1, lengths: [100] })
    const run = await createRun(firestore, { corpusProjectId: projectId, name: 'Run 1', modelProvider: 'openai', model: 'gpt-4o-mini' })
    await updateRunDraft(firestore, run.id, { intensities: [5] }) // breaks A2H-02's >=2 requirement

    const { run: stillDraft, result } = await validateRun(firestore, run.id, OK_OPTIONS)
    expect(result.ok).toBe(false)
    expect(stillDraft.status).toBe('draft')
    expect(await listRunSources(firestore, run.id)).toHaveLength(0)
  })
})

describe('run status transitions', () => {
  it('startRun requires a validated run and enqueues one baseline job per cohort source', async () => {
    const { firestore } = makeFirestore()
    const projectId = await buildFrozenCorpus(firestore, { domains: ['general'], topicsPerDomain: 2, lengths: [100, 200] })
    const run = await createRun(firestore, { corpusProjectId: projectId, name: 'Run 1', modelProvider: 'openai', model: 'gpt-4o-mini' })

    await expect(startRun(firestore, run.id)).rejects.toThrow(/not validated/i)

    await validateRun(firestore, run.id, OK_OPTIONS)
    const started = await startRun(firestore, run.id)
    expect(started.status).toBe('running')
    expect(started.startedAt).not.toBeNull()

    const jobs = await listJobsForRun(firestore, run.id)
    const baselineJobs = jobs.filter(j => j.stage === 'baseline_gptzero')
    expect(baselineJobs).toHaveLength(4) // 2 topics x 2 lengths = 4 cohort sources
    expect(baselineJobs.every(j => j.status === 'queued')).toBe(true)
  })

  it('starting an already-started run again is idempotent — no duplicate jobs', async () => {
    const { firestore } = makeFirestore()
    const projectId = await buildFrozenCorpus(firestore, { domains: ['general'], topicsPerDomain: 1, lengths: [100] })
    const run = await createRun(firestore, { corpusProjectId: projectId, name: 'Run 1', modelProvider: 'openai', model: 'gpt-4o-mini' })
    await validateRun(firestore, run.id, OK_OPTIONS)
    await startRun(firestore, run.id)
    // Re-validate then start again is refused (status is 'running' now) —
    // the realistic "idempotent" path is getOrCreateJob itself, already
    // covered in jobs.test.ts; this confirms startRun's own guard.
    await expect(startRun(firestore, run.id)).rejects.toThrow(/not validated/i)
  })

  it('pause requires running, resume requires paused', async () => {
    const { firestore } = makeFirestore()
    const projectId = await buildFrozenCorpus(firestore, { domains: ['general'], topicsPerDomain: 1, lengths: [100] })
    const run = await createRun(firestore, { corpusProjectId: projectId, name: 'Run 1', modelProvider: 'openai', model: 'gpt-4o-mini' })

    await expect(pauseRun(firestore, run.id)).rejects.toThrow(/not running/i)
    await validateRun(firestore, run.id, OK_OPTIONS)
    await startRun(firestore, run.id)

    const paused = await pauseRun(firestore, run.id)
    expect(paused.status).toBe('paused')
    await expect(startRun(firestore, run.id)).rejects.toThrow(/not validated/i)
    await expect(pauseRun(firestore, run.id)).rejects.toThrow(/not running/i)

    const resumed = await resumeRun(firestore, run.id)
    expect(resumed.status).toBe('running')
    await expect(resumeRun(firestore, run.id)).rejects.toThrow(/not paused/i)
  })

  it('cancel marks queued jobs cancelled but preserves completed ones', async () => {
    const { firestore } = makeFirestore()
    const projectId = await buildFrozenCorpus(firestore, { domains: ['general'], topicsPerDomain: 1, lengths: [100] })
    const run = await createRun(firestore, { corpusProjectId: projectId, name: 'Run 1', modelProvider: 'openai', model: 'gpt-4o-mini' })
    await validateRun(firestore, run.id, OK_OPTIONS)
    await startRun(firestore, run.id)

    const [job] = await listJobsForRun(firestore, run.id)
    await firestore.collection('a2hBenchmarkJobs').doc(job!.id).update({ status: 'completed', completedAt: new Date().toISOString() })

    const cancelled = await cancelRun(firestore, run.id)
    expect(cancelled.status).toBe('cancelled')
    const jobsAfter = await listJobsForRun(firestore, run.id)
    expect(jobsAfter.find(j => j.id === job!.id)?.status).toBe('completed')
  })

  it('cannot cancel an already-completed or already-cancelled run', async () => {
    const { firestore } = makeFirestore()
    const projectId = await buildFrozenCorpus(firestore, { domains: ['general'], topicsPerDomain: 1, lengths: [100] })
    const run = await createRun(firestore, { corpusProjectId: projectId, name: 'Run 1', modelProvider: 'openai', model: 'gpt-4o-mini' })
    await validateRun(firestore, run.id, OK_OPTIONS)
    await startRun(firestore, run.id)
    await cancelRun(firestore, run.id)
    await expect(cancelRun(firestore, run.id)).rejects.toThrow(/already/i)
  })
})

describe('getRunProgress', () => {
  it('reports zero completion right after start', async () => {
    const { firestore } = makeFirestore()
    const projectId = await buildFrozenCorpus(firestore, { domains: ['general'], topicsPerDomain: 1, lengths: [100] })
    const run = await createRun(firestore, { corpusProjectId: projectId, name: 'Run 1', modelProvider: 'openai', model: 'gpt-4o-mini' })
    await updateRunDraft(firestore, run.id, { intensities: [2, 5] })
    await validateRun(firestore, run.id, OK_OPTIONS)
    await startRun(firestore, run.id)

    const progress = await getRunProgress(firestore, run.id)
    expect(progress.sources).toBe(1)
    expect(progress.baselinesTotal).toBe(1)
    expect(progress.baselinesCompleted).toBe(0)
    expect(progress.outputsTotal).toBe(2) // 1 source x 2 intensities
    expect(progress.testResultsTotal).toBe(4) // 2 outputs x (A2H-01 + A2H-02)
    expect(progress.queuedJobs).toBe(1)
  })
})

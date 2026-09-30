import { describe, it, expect, vi, afterEach } from 'vitest'
import type { Firestore } from 'firebase-admin/firestore'
import type OpenAI from 'openai'
import type { Domain } from '@/lib/style/types'
import { executeRunBatch } from '../execution'
import { createRun, updateRunDraft, validateRun, startRun, getRun } from '../runs'
import { createCorpusProject, updateProjectDraft, lockBlueprint, freezeCorpusProject } from '../corpusProject'
import { createTopic, listTopics } from '../topics'
import type { CreateTopicInput } from '../topics'
import { generateSource, freezeSource } from '../corpus'
import { createRelease } from '../release'
import { toCsv, buildExportFile, EXPORT_FILE_NAMES } from '../exportPackage'

// Same per-collection-map fake as release.test.ts/execution.test.ts.
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
      choices: [{ message: { content: 'A humanized rewrite of the source text, produced for export-layer test purposes only.' }, finish_reason: 'stop' }],
      usage: { total_tokens: 500 },
    }
  })
  return { chat: { completions: { create: chatCreate } } } as unknown as OpenAI
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

async function buildFrozenCorpus(firestore: Firestore, opts: { domains: Domain[]; topicsPerDomain: number; lengths: number[] }): Promise<string> {
  const project = await createCorpusProject(firestore, { name: 'Export Test Corpus' })
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

async function runToCompletion(firestore: Firestore, runId: string, client: OpenAI, maxIterations = 200): Promise<void> {
  for (let i = 0; i < maxIterations; i++) {
    const run = await getRun(firestore, runId)
    if (!run || run.status !== 'running') return
    await executeRunBatch(firestore, runId, { ...EXECUTE_OPTIONS, client, maxJobsPerStage: 25 })
  }
  throw new Error(`runToCompletion did not finish within ${maxIterations} iterations`)
}

async function buildCompletedRun(firestore: Firestore): Promise<string> {
  vi.stubGlobal('fetch', vi.fn().mockImplementation(() => jsonResponse(200, {
    classification: 'ai',
    class_probabilities: { human: 0.05, ai: 0.9, mixed: 0.05 },
  })))
  const corpusProjectId = await buildFrozenCorpus(firestore, { domains: ['general'], topicsPerDomain: 2, lengths: [100] })
  const run = await createRun(firestore, { corpusProjectId, name: 'Export Test Run', modelProvider: 'openai', model: 'gpt-4o-mini' })
  await updateRunDraft(firestore, run.id, { intensities: [3, 6] })
  await validateRun(firestore, run.id, { hasModelConfig: true, hasDetectorConfig: true })
  await startRun(firestore, run.id)
  await runToCompletion(firestore, run.id, humanizeStubClient())
  const finalRun = await getRun(firestore, run.id)
  expect(finalRun?.status).toBe('completed')
  return run.id
}

describe('toCsv', () => {
  it('escapes commas, quotes, and newlines, and stringifies objects', () => {
    const rows = [
      { a: 'plain', b: 'has,comma', c: 'has "quote"', d: 'line\nbreak', e: null, f: { nested: 1 } },
    ]
    const csv = toCsv(rows, ['a', 'b', 'c', 'd', 'e', 'f'])
    expect(csv).toBe('a,b,c,d,e,f\nplain,"has,comma","has ""quote""","line\nbreak",,"{""nested"":1}"')
  })

  it('emits just the header row for an empty input', () => {
    expect(toCsv([], ['a', 'b'])).toBe('a,b')
  })
})

describe('buildExportFile', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns null for a nonexistent run', async () => {
    const { firestore } = makeFirestore()
    expect(await buildExportFile(firestore, 'nonexistent-run', 'run-config.json')).toBeNull()
  })

  it('exports every declared file name with the right content type and non-empty content', async () => {
    const { firestore } = makeFirestore()
    const runId = await buildCompletedRun(firestore)

    for (const name of EXPORT_FILE_NAMES) {
      const file = await buildExportFile(firestore, runId, name)
      expect(file).not.toBeNull()
      expect(file!.name).toBe(name)
      expect(file!.contentType).toBe(name.endsWith('.csv') ? 'text/csv' : 'application/json')
      expect(file!.content.length).toBeGreaterThan(0)
    }
  })

  it('sources.csv and outputs.csv redact full text to its length rather than exporting it raw', async () => {
    const { firestore } = makeFirestore()
    const runId = await buildCompletedRun(firestore)

    const sourcesFile = await buildExportFile(firestore, runId, 'sources.csv')
    const sourceLines = sourcesFile!.content.split('\n')
    expect(sourceLines).toHaveLength(1 + 2) // header + 2 sources
    const textColumnIndex = sourceLines[0]!.split(',').indexOf('text')
    for (const line of sourceLines.slice(1)) {
      const value = line.split(',')[textColumnIndex]!
      expect(Number.isInteger(Number(value))).toBe(true)
      expect(Number(value)).toBeGreaterThan(0)
    }

    const outputsFile = await buildExportFile(firestore, runId, 'outputs.csv')
    const outputLines = outputsFile!.content.split('\n')
    expect(outputLines).toHaveLength(1 + 4) // header + 2 sources x 2 intensities
    const outputTextIndex = outputLines[0]!.split(',').indexOf('outputText')
    for (const line of outputLines.slice(1)) {
      expect(Number.isInteger(Number(line.split(',')[outputTextIndex]))).toBe(true)
    }
  })

  it('outputs.csv carries real telemetry (modelCalls/tokens), not the old null placeholders', async () => {
    const { firestore } = makeFirestore()
    const runId = await buildCompletedRun(firestore)
    const outputsFile = await buildExportFile(firestore, runId, 'outputs.csv')
    const [header, ...lines] = outputsFile!.content.split('\n')
    const cols = header!.split(',')
    const modelCallsIdx = cols.indexOf('modelCalls')
    for (const line of lines) {
      expect(Number(line.split(',')[modelCallsIdx])).toBeGreaterThan(0)
    }
  })

  it('summary.json reflects a live recomputation before release, and the frozen snapshot after', async () => {
    const { firestore } = makeFirestore()
    const runId = await buildCompletedRun(firestore)

    const beforeRelease = await buildExportFile(firestore, runId, 'summary.json')
    const liveSummary = JSON.parse(beforeRelease!.content)
    expect(liveSummary['A2H-01']).toBeDefined()

    const { release } = await createRelease(firestore, runId)
    const afterRelease = await buildExportFile(firestore, runId, 'summary.json')
    const frozenSummary = JSON.parse(afterRelease!.content)
    // Compare through a JSON round-trip on both sides — aggregateSnapshot
    // itself is the source of truth, but a couple of its numeric fields
    // (e.g. a NaN correlation with only one contrast step) are not
    // JSON-representable and become null through JSON.stringify, on both
    // the live and the frozen path alike.
    expect(frozenSummary).toEqual(JSON.parse(JSON.stringify(release!.aggregateSnapshot)))
  })

  it('benchmark-release.json is null before release and the full release afterward', async () => {
    const { firestore } = makeFirestore()
    const runId = await buildCompletedRun(firestore)

    const beforeRelease = await buildExportFile(firestore, runId, 'benchmark-release.json')
    expect(JSON.parse(beforeRelease!.content)).toBeNull()

    const { release } = await createRelease(firestore, runId)
    const afterRelease = await buildExportFile(firestore, runId, 'benchmark-release.json')
    expect(JSON.parse(afterRelease!.content).id).toBe(release!.id)
  })

  it('fixture-manifest.json is null when the run has no fixture set', async () => {
    const { firestore } = makeFirestore()
    const runId = await buildCompletedRun(firestore)
    const file = await buildExportFile(firestore, runId, 'fixture-manifest.json')
    expect(JSON.parse(file!.content)).toBeNull()
  })
})

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

const EXECUTE_OPTIONS = { model: 'gpt-4o-mini', modelProvider: 'openai', gptZeroApiKey: 'test-key' }

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

  // "Final Polish" patch, §10-11/§26: a baseline's identity is
  // (sourceId, detectorConfigId), not runId — a run that REUSES an older
  // baseline never appears as that baseline's own `runId`, so
  // listDetectorEvidenceForRun (not the old runId-filtered query) must be
  // what detector-results.csv is built from, or a reusing run's export
  // silently drops every baseline it actually depends on.
  it("detector-results.csv includes a REUSED cross-run baseline plus the reusing run's own post-scores, each exactly once", async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => jsonResponse(200, {
      classification: 'ai',
      class_probabilities: { human: 0.05, ai: 0.9, mixed: 0.05 },
    })))
    const { firestore } = makeFirestore()
    const projectId = await buildFrozenCorpus(firestore, { domains: ['general'], topicsPerDomain: 2, lengths: [100] })

    const runA = await createRun(firestore, { corpusProjectId: projectId, name: 'Export Run A', modelProvider: 'openai', model: 'gpt-4o-mini' })
    await updateRunDraft(firestore, runA.id, { intensities: [3, 6] })
    await validateRun(firestore, runA.id, { hasModelConfig: true, hasDetectorConfig: true })
    await startRun(firestore, runA.id)
    await runToCompletion(firestore, runA.id, humanizeStubClient())

    const runB = await createRun(firestore, { corpusProjectId: projectId, name: 'Export Run B', modelProvider: 'openai', model: 'gpt-4o-mini' })
    await updateRunDraft(firestore, runB.id, { intensities: [3, 6] })
    await validateRun(firestore, runB.id, { hasModelConfig: true, hasDetectorConfig: true })
    await startRun(firestore, runB.id)
    await runToCompletion(firestore, runB.id, humanizeStubClient())

    const file = await buildExportFile(firestore, runB.id, 'detector-results.csv')
    const [header, ...lines] = file!.content.trim().split('\n')
    const cols = header!.split(',')
    const idIdx = cols.indexOf('id')
    const stageIdx = cols.indexOf('stage')
    const runIdIdx = cols.indexOf('runId')
    const reusedIdx = cols.indexOf('baselineReusedAcrossRuns')

    // 2 sources -> 2 shared baselines (reused from Run A, not re-created by
    // Run B) + 4 of Run B's own post-scores (2 sources x 2 intensities).
    expect(lines).toHaveLength(6)
    // Every row id appears exactly once — no duplicate baseline entries even
    // though Run B's cohort and Run A's cohort both reference it.
    const ids = lines.map(l => l.split(',')[idIdx])
    expect(new Set(ids).size).toBe(ids.length)

    const baselineRows = lines.filter(l => l.split(',')[stageIdx] === 'baseline')
    const postScoreRows = lines.filter(l => l.split(',')[stageIdx] === 'post_transform')
    expect(baselineRows).toHaveLength(2)
    expect(postScoreRows).toHaveLength(4)

    // The reused baselines still carry Run A's id as provenance (who first
    // paid for them), flagged as reused-across-runs; Run B's own post-scores
    // carry Run B's id and are never flagged as a reused baseline.
    for (const row of baselineRows) {
      expect(row.split(',')[runIdIdx]).toBe(runA.id)
      expect(row.split(',')[reusedIdx]).toBe('true')
    }
    for (const row of postScoreRows) {
      expect(row.split(',')[runIdIdx]).toBe(runB.id)
      expect(row.split(',')[reusedIdx]).toBe('false')
    }
  })
})

// Test harness for the pack: a fake Humanite endpoint and a fake GPTZero-compatible detector (local http servers),
// in-memory DatasetAccess and BenchmarkMemo, a tiny A2H corpus with fixtures, and a mini runner that drives a trial
// through createTrialSpec -> adapter (prepare, start, collect, cleanup) -> verify -> score exactly as BenchMarkr's
// pipeline does (JSON round trips and frozen specs included), then aggregates.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createHash } from 'node:crypto'
import {
  deepFreeze,
  parseBatchId,
  parseCapabilityId,
  parseConnectionProfileId,
  parseCredentialId,
  parseTargetId,
  parseTrialId,
  parseWorkspaceId,
  parseAdapterId,
  parseDatasetInputId,
  parseServiceRoleId,
  type AggregateResult,
  type BatchId,
  type BatchManifest,
  type JsonObject,
} from '@benchmarkr/core'
import type {
  BenchmarkExecutionContext,
  BenchmarkMemo,
  BenchmarkPackage,
  BenchmarkRuntime,
  DatasetAccess,
  DatasetItemView,
  ScoredResult,
  ServiceAccess,
  TargetAdapter,
  TargetExecutionContext,
  TrialSpec,
  VerificationResult,
} from '@benchmarkr/contracts'
import { deriveNumericUnitFixtureExpected } from '../../src/scoring/a2h05'
import { normalizeCitation } from '../../src/shared/citationNormalize'
import { INITIAL_FACTUAL_FIXTURES } from '../../src/scoring/a2h12'
import { INITIAL_GRAMMAR_FIXTURES } from '../../src/scoring/a2h06'
import { effectiveIntensity } from '../../src/vendor/intensity'
import type { Domain } from '../../src/vendor/style/types'

export const TOKEN = 'humanite-test-token-9f3a'
export const DETECTOR_KEY = 'detector-test-key-77c1'
export const CREDENTIAL_ID = parseCredentialId('crd_target1')
const sha = (s: string): string => createHash('sha256').update(s).digest('hex')

// ── servers ──────────────────────────────────────────────────────────────

export interface Recorded {
  readonly headers: IncomingMessage['headers']
  readonly body: Record<string, unknown>
}

async function listen(handler: (req: IncomingMessage, res: ServerResponse, body: string) => void): Promise<{ server: Server; origin: string; close: () => Promise<void> }> {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => handler(req, res, Buffer.concat(chunks).toString('utf8')))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return { server, origin: `http://127.0.0.1:${String(port)}`, close: () => new Promise<void>((resolve) => server.close(() => resolve())) }
}

const send = (res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void => {
  res.writeHead(status, { 'content-type': 'application/json', ...headers })
  res.end(JSON.stringify(body))
}

/** Deterministic stand-in for Humanite's humanize: words are swapped, protected content is kept. */
export function fakeHumanize(text: string, applied: number, damage: boolean, keepAi = false): string {
  let out = (keepAi ? text : text.replace(/\bdelve\b/g, 'dig')).replace(/\butilize\b/g, 'use')
  if (applied >= 4) out = out.replace(/\bfurthermore\b/gi, 'also')
  if (applied >= 7) out = out.replace(/\bnumerous\b/g, 'many')
  if (damage) out = out.replace(/\bmust\b/g, 'may')
  return out
}

export interface FakeHumaniteOptions {
  /** Answer 429 this many times before succeeding (with Retry-After: 0). */
  rateLimitFirst?: number
  /** Answer this status for every request (an error body is sent). */
  failWith?: number
  damage?: boolean
  /** Leave the AI-flavoured wording in place, so the detector still classifies the output as AI. */
  keepAi?: boolean
  /** Make humanize answer with an empty output. */
  emptyOutput?: boolean
  /** Telemetry for candidate-selection tests. */
  candidateSelection?: boolean
  malformed?: boolean
}

export async function startHumanite(options: FakeHumaniteOptions = {}) {
  const requests: Recorded[] = []
  let limited = 0
  const repairs = new Map(INITIAL_GRAMMAR_FIXTURES.map((f) => [f.corruptedText, f.cleanText]))
  const s = await listen((req, res, raw) => {
    if (req.method !== 'POST' || req.url !== '/api/v1/benchmark/run') return send(res, 404, { error: { code: 'NOT_FOUND', message: 'no such route' } })
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(res, 401, { error: { code: 'UNAUTHORIZED', message: 'bad token' } })
    let body: Record<string, unknown>
    try {
      body = JSON.parse(raw) as Record<string, unknown>
    } catch {
      return send(res, 400, { error: { code: 'BAD_JSON', message: 'x' } })
    }
    requests.push({ headers: req.headers, body })
    if (typeof body['text'] !== 'string' || body['text'] === '') return send(res, 400, { error: { code: 'INVALID_TEXT', message: 'text is required' } })
    if (options.rateLimitFirst !== undefined && limited < options.rateLimitFirst) {
      limited += 1
      return send(res, 429, { error: { code: 'RATE_LIMITED', message: 'slow down' } }, { 'retry-after': '0' })
    }
    if (options.failWith !== undefined) return send(res, options.failWith, { error: { code: 'BOOM', message: `secret text ${String(body['text']).slice(0, 20)}` } })
    if (options.malformed) return res.writeHead(200, { 'content-type': 'application/json' }).end('not json')
    const text = body['text']
    const telemetry = { modelCalls: 2, inputTokens: text.length, outputTokens: text.length, retryCount: 1, latencyMs: 120 }
    if (body['operation'] === 'humanize') {
      const settings = body['settings'] as { intensity: number; domain: Domain }
      const eff = effectiveIntensity(settings.intensity, settings.domain)
      const production = body['candidateCountOverride'] !== 1
      const output = options.emptyOutput ? '' : fakeHumanize(text, eff.applied, options.damage === true, options.keepAi === true)
      return send(res, 200, {
        output,
        requestedIntensity: eff.requested,
        appliedIntensity: eff.applied,
        intensityCapped: eff.capped,
        candidateCount: production ? 2 : 1,
        modelUsed: 'fake-model-1',
        ...telemetry,
        ...(options.candidateSelection
          ? { candidateSelection: { ranCandidateSearch: production, candidateCount: production ? 2 : 1, disqualifiedAt: null }, gatesUnavailable: false, gatePassed: true }
          : {}),
      })
    }
    if (body['operation'] === 'repair_grammar') return send(res, 200, { output: repairs.get(text) ?? text, ...telemetry, modelCalls: 1 })
    if (body['operation'] === 'repair_facts') {
      const extra = body['extra'] as { sourceText?: string } | undefined
      return send(res, 200, { output: extra?.sourceText ?? text, ...telemetry })
    }
    return send(res, 400, { error: { code: 'BAD_OPERATION', message: 'x' } })
  })
  return { ...s, requests }
}

export async function startDetector() {
  const requests: Recorded[] = []
  const s = await listen((req, res, raw) => {
    if (req.method !== 'POST' || req.url !== '/v2/predict/text') return send(res, 404, { message: 'no' })
    if (req.headers['x-api-key'] !== DETECTOR_KEY) return send(res, 401, { message: 'bad key' })
    const body = JSON.parse(raw) as { document: string }
    requests.push({ headers: req.headers, body })
    const ai = /\bdelve\b/.test(body.document)
    send(res, 200, {
      documents: [
        {
          document_classification: ai ? 'AI_ONLY' : 'HUMAN_ONLY',
          class_probabilities: ai ? { ai: 0.92, human: 0.05, mixed: 0.03 } : { ai: 0.08, human: 0.9, mixed: 0.02 },
        },
      ],
    })
  })
  return { ...s, requests }
}

// ── datasets ─────────────────────────────────────────────────────────────

const canonical = (v: unknown): string => JSON.stringify(v, (_k, value: unknown) => (value !== null && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value as object).sort(([a], [b]) => a.localeCompare(b))) : value))

export function item(key: string, dimensions: Record<string, string | number>, content: JsonObject): DatasetItemView {
  return { key, dimensions, content, hash: sha(canonical({ key, dimensions, content })) }
}

export class FakeDatasets implements DatasetAccess {
  readonly reads = { list: 0, get: 0, at: 0 }
  constructor(private readonly inputs: Record<string, DatasetItemView[]>) {
    for (const list of Object.values(inputs)) list.sort((a, b) => (a.key < b.key ? -1 : 1))
  }
  has(input: string): boolean {
    return Object.hasOwn(this.inputs, input)
  }
  private list_(input: string): DatasetItemView[] {
    const list = this.inputs[input]
    if (list === undefined) throw new Error(`input ${input} is not bound`)
    return list
  }
  count(input: string): Promise<number> {
    return Promise.resolve(this.list_(input).length)
  }
  at(input: string, index: number): Promise<DatasetItemView | undefined> {
    this.reads.at += 1
    return Promise.resolve(this.list_(input)[index])
  }
  get(input: string, key: string): Promise<DatasetItemView | undefined> {
    this.reads.get += 1
    return Promise.resolve(this.list_(input).find((i) => i.key === key))
  }
  list(input: string, options?: { after?: string; limit?: number }): Promise<readonly DatasetItemView[]> {
    this.reads.list += 1
    const all = this.list_(input)
    const start = options?.after === undefined ? 0 : all.findIndex((i) => i.key > (options.after as string))
    if (start < 0) return Promise.resolve([])
    return Promise.resolve(all.slice(start, start + Math.min(options?.limit ?? 100, 1000)))
  }
  fingerprint(input: string): string {
    return `sha256:${sha(this.list_(input).map((i) => `${i.key}:${i.hash}`).join('|'))}`
  }
}

export class FakeMemo implements BenchmarkMemo {
  readonly store = new Map<string, JsonObject>()
  computes = 0
  constructor(private readonly origin: BatchId) {}
  async getOrCompute(namespace: string, key: string, compute: () => Promise<JsonObject>) {
    const id = `${namespace}|${key}`
    const hit = this.store.get(id)
    if (hit !== undefined) return { value: hit, cached: true, computedBy: this.origin }
    this.computes += 1
    const value = await compute()
    this.store.set(id, value)
    return { value, cached: false, computedBy: this.origin }
  }
}

// ── the tiny corpus ──────────────────────────────────────────────────────

const SENTENCES = [
  'Researchers delve into the subject and utilize several methods [1].',
  'The recommended dose is 5 mg per day, and patients must rest.',
  'The ACME-7 protocol is used throughout this document.',
  'Furthermore, numerous teams confirm the protocol in practice.',
  'The protocol is documented in the annex.',
]

export const DOMAINS_USED: Domain[] = ['general', 'legal']
export const LENGTHS_USED = [100, 200]
export const TOPICS_USED = [1, 2]

export function corpusKey(domain: string, topic: number, words: number): string {
  return `${domain}__${String(topic)}__${String(words)}`
}

export function corpusText(domain: string, topic: number, words: number): string {
  const main = SENTENCES.map((s) => `${s} (${domain} topic ${String(topic)})`).join(' ')
  // The longer documents add filler that repeats none of the protected content (a repeat would count as a duplicate).
  const filler = words === 100 ? [] : ['The annex lists further background material for this subject.', 'Readers may consult it when they need more detail on the history.']
  return [main, ...filler].join('\n\n')
}

/** Exported-style corpus items (rich content) or generated-style ones (text only). */
export function corpusItems(style: 'exported' | 'generated' = 'exported'): DatasetItemView[] {
  const out: DatasetItemView[] = []
  for (const domain of DOMAINS_USED) {
    for (const topic of TOPICS_USED) {
      for (const words of LENGTHS_USED) {
        const key = corpusKey(domain, topic, words)
        const text = corpusText(domain, topic, words)
        out.push(
          item(
            key,
            { domain, topic, words },
            style === 'generated'
              ? { text }
              : { sourceId: key, domain, topicId: `${domain}-topic-${String(topic)}`, targetWords: words, text, wordCount: text.split(/\s+/).length },
          ),
        )
      }
    }
  }
  return out
}

function fixtureItem(sourceKey: string, domain: string, topic: number, words: number, type: string, ordinal: number, expected: JsonObject, extra: JsonObject = {}): DatasetItemView {
  const key = `${sourceKey}__${type}__${String(ordinal)}`
  return item(key, { type, domain, topic, words, ordinal }, { fixtureId: key, sourceId: sourceKey, type, ordinal, expected, ...extra })
}

/** One fixture of every type on every source (the repair ones borrow Humanite's initial fixtures). */
export function fixtureItems(): DatasetItemView[] {
  const out: DatasetItemView[] = []
  let repair = 0
  for (const domain of DOMAINS_USED) {
    for (const topic of TOPICS_USED) {
      for (const words of LENGTHS_USED) {
        const key = corpusKey(domain, topic, words)
        const f = (type: string, expected: JsonObject, extra?: JsonObject): void => {
          out.push(fixtureItem(key, domain, topic, words, type, 1, expected, extra))
        }
        f('citation', { kind: 'numeric', exactText: '[1]', normalizedText: normalizeCitation('numeric', '[1]') })
        f('numeric_unit', deriveNumericUnitFixtureExpected('value_unit', '5 mg') as unknown as JsonObject)
        f('modality', { exactText: 'must', category: 'necessity', strength: 1, approvedEquivalentForms: [], anchorText: 'patients must rest' })
        f('protected_term', { kind: 'identifier', exactText: 'ACME-7', caseSensitive: true, allowedVariants: [] })
        f('terminology', { preferredTerm: 'protocol', allowedVariants: [], forbiddenVariants: ['procedure'], caseSensitive: false, expectedMinimumOccurrences: null })
        f('claim_relationship', { category: 'attribution', sourceText: 'The ACME-7 protocol is used throughout this document.', relation: 'used', approvedEquivalentForms: [], knownCorruptions: [{ type: 'dropped', text: 'The ACME-7 protocol is never used' }] })
        const g = INITIAL_GRAMMAR_FIXTURES[repair % INITIAL_GRAMMAR_FIXTURES.length]!
        f('grammar_repair', g as unknown as JsonObject, { cleanText: g.cleanText, corruptedText: g.corruptedText })
        const fa = INITIAL_FACTUAL_FIXTURES[repair % INITIAL_FACTUAL_FIXTURES.length]!
        out.push(fixtureItem(key, domain, topic, words, 'factual_repair', 2, fa as unknown as JsonObject, { cleanText: fa.cleanText, corruptedText: fa.corruptedText }))
        repair += 1
      }
    }
  }
  return out
}

// ── the mini runner ──────────────────────────────────────────────────────

export const BATCH = parseBatchId('bat_testrun1')
export const ORIGIN_BATCH = parseBatchId('bat_firstrun')
const WORKSPACE = parseWorkspaceId('wsp_test')

export interface Env {
  readonly pkg: BenchmarkPackage
  readonly adapter: TargetAdapter
  readonly datasets: FakeDatasets
  readonly memo: FakeMemo
  readonly humanite: { origin: string }
  readonly detector: { origin: string } | undefined
  readonly controller: AbortController
  trialsPerTest: number
  planned: Record<string, number>
  selected: string[]
  /** Config overrides for the target connection. */
  configOverride?: Record<string, unknown>
  detectorBound: boolean
  detectorSecret?: unknown
}

export function services(env: Env): ServiceAccess {
  return {
    has: (role) => role === parseServiceRoleId('detector') && env.detectorBound,
    resolve: (role) => {
      if (role !== parseServiceRoleId('detector') || !env.detectorBound) throw new Error('role not bound')
      const secret = env.detectorSecret ?? { token: DETECTOR_KEY, baseUrl: env.detector?.origin }
      return Promise.resolve({ type: 'api_key' as never, secret: typeof secret === 'string' ? secret : JSON.stringify(secret) })
    },
  }
}

export function execContext(env: Env): TargetExecutionContext {
  return {
    workspaceId: WORKSPACE,
    targetId: parseTargetId('tgt_a2h'),
    adapterId: parseAdapterId('com.humanite.a2h-target'),
    connection: {
      profileId: parseConnectionProfileId('cpr_a2h'),
      config: { baseUrl: env.humanite.origin, credentialId: CREDENTIAL_ID, requestTimeoutMs: 20_000, ...(env.configOverride ?? {}) } as JsonObject,
    },
    credentials: {
      resolve: (id) => {
        if (id !== CREDENTIAL_ID) throw new Error('credential not available')
        return Promise.resolve({ type: 'humanite_service_token' as never, secret: JSON.stringify({ token: TOKEN }) })
      },
    },
    signal: env.controller.signal,
  }
}

export function manifestFor(env: Env): BatchManifest {
  return {
    batchId: BATCH,
    selection: { testIds: env.selected, trialsPerTest: env.trialsPerTest, plannedTrials: env.planned },
  } as unknown as BatchManifest
}

function runtime(env: Env): BenchmarkRuntime {
  return { services: services(env), signal: env.controller.signal, datasets: env.datasets, memo: env.memo }
}

export const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

export interface TrialOutcome {
  spec: TrialSpec
  verification: VerificationResult
  scored: ScoredResult
  raw: Awaited<ReturnType<TargetAdapter['collectResult']>>
}

export function context(env: Env, testId: string, trialIndex: number, attempt = 1): BenchmarkExecutionContext {
  return {
    workspaceId: WORKSPACE,
    batchId: BATCH,
    manifest: manifestFor(env),
    targetCapabilities: { capabilities: [parseCapabilityId('structured-task-execution')] },
    signal: env.controller.signal,
    services: services(env),
    datasets: env.datasets,
    trial: { trialId: parseTrialId(`tri_${testId.replace(/\W/g, '')}_${String(trialIndex)}_${String(attempt)}`), trialIndex, attempt },
  } as BenchmarkExecutionContext
}

export async function plan(env: Env, testId: string): Promise<number> {
  return env.pkg.planTrials!(testId as never, {
    workspaceId: WORKSPACE,
    targetCapabilities: { capabilities: [] },
    datasets: env.datasets,
    requestedTrials: env.trialsPerTest,
    signal: env.controller.signal,
  })
}

export async function runTrial(env: Env, testId: string, trialIndex: number, attempt = 1): Promise<TrialOutcome> {
  const spec = deepFreeze(plain(await env.pkg.createTrialSpec(testId as never, context(env, testId, trialIndex, attempt))))
  const ctx = execContext(env)
  const prepared = await env.adapter.prepareTrial(ctx, spec)
  let handle
  try {
    handle = await env.adapter.startTrial(ctx, prepared)
    const raw = deepFreeze(plain(await env.adapter.collectResult(ctx, handle)))
    const verification = deepFreeze(plain(await env.pkg.verify(spec, raw, undefined, runtime(env))))
    const scored = plain(await env.pkg.score(verification, raw, runtime(env)))
    return { spec, verification, scored, raw }
  } finally {
    await env.adapter.cleanupTrial(ctx, handle ?? { trialId: spec.trialId, state: prepared.state })
  }
}

/** Plans the test, runs every planned trial, and returns the outcomes. */
export async function runTest(env: Env, testId: string): Promise<TrialOutcome[]> {
  const total = await plan(env, testId)
  env.planned = { ...env.planned, [testId]: total }
  const outcomes: TrialOutcome[] = []
  for (let i = 0; i < total; i += 1) outcomes.push(await runTrial(env, testId, i))
  return outcomes
}

export async function aggregateOf(env: Env, scored: ScoredResult[], level: { testId?: string; categoryId?: string } = {}): Promise<AggregateResult> {
  const result = await env.pkg.aggregate(scored, { manifest: manifestFor(env), scope: 'scope' as never, ...(level.testId === undefined ? {} : { testId: level.testId as never }), ...(level.categoryId === undefined ? {} : { categoryId: level.categoryId as never }) })
  return plain(result)
}

export interface Fixture {
  env: Env
  stop: () => Promise<void>
}

export async function makeEnv(
  pkg: BenchmarkPackage,
  adapter: TargetAdapter,
  humaniteOptions: FakeHumaniteOptions = {},
  inputs: { corpus?: DatasetItemView[]; fixtures?: DatasetItemView[] | null } = {},
): Promise<Fixture & { humanite: Awaited<ReturnType<typeof startHumanite>>; detector: Awaited<ReturnType<typeof startDetector>> }> {
  const humanite = await startHumanite(humaniteOptions)
  const detector = await startDetector()
  const sets: Record<string, DatasetItemView[]> = { [parseDatasetInputId('corpus')]: inputs.corpus ?? corpusItems() }
  if (inputs.fixtures !== null) sets[parseDatasetInputId('fixtures')] = inputs.fixtures ?? fixtureItems()
  const env: Env = {
    pkg,
    adapter,
    datasets: new FakeDatasets(sets),
    memo: new FakeMemo(ORIGIN_BATCH),
    humanite,
    detector,
    controller: new AbortController(),
    trialsPerTest: 20,
    planned: {},
    selected: [],
    detectorBound: true,
  }
  return { env, humanite, detector, stop: async () => { await humanite.close(); await detector.close() } }
}

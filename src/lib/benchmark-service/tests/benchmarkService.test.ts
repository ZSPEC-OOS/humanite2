import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/lib/runHumaniteDocument', () => ({
  runHumaniteDocument: vi.fn(),
}))
vi.mock('@/lib/evaluation/repair', () => ({
  repairGrammar: vi.fn(),
  repairChunk: vi.fn(),
}))

import { runHumaniteDocument } from '@/lib/runHumaniteDocument'
import { repairGrammar, repairChunk } from '@/lib/evaluation/repair'
import { authorizeBenchmarkRequest, resetAuthLogStateForTests } from '../auth'
import { validateBenchmarkRequest } from '../validate'
import { handleBenchmarkRun, handleBenchmarkHealth } from '../handlers'

const TOKEN = 'a'.repeat(32) + 'XYZ-secret-token'
const fakeClient = { client: {} as never, model: 'test-model' }
const deps = { createClient: () => fakeClient }

function req(body: unknown, headers: Record<string, string> = { authorization: `Bearer ${TOKEN}` }, raw?: string) {
  return new Request('http://localhost/api/v1/benchmark/run', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: raw ?? JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  resetAuthLogStateForTests()
  process.env.HUMANITE_BENCHMARK_TOKEN = TOKEN
})
afterEach(() => {
  delete process.env.HUMANITE_BENCHMARK_TOKEN
  vi.restoreAllMocks()
})

describe('auth', () => {
  it('404 when token unset or empty', () => {
    expect(authorizeBenchmarkRequest('Bearer x', undefined)).toMatchObject({ ok: false, status: 404 })
    expect(authorizeBenchmarkRequest('Bearer x', '')).toMatchObject({ ok: false, status: 404 })
  })
  it('404 and one log line without the token when token too short', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const short = 'short-secret-token'
    expect(authorizeBenchmarkRequest(`Bearer ${short}`, short)).toMatchObject({ ok: false, status: 404 })
    authorizeBenchmarkRequest(`Bearer ${short}`, short)
    expect(spy).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(spy.mock.calls)).not.toContain(short)
  })
  it('401 for missing, malformed, wrong or different-length tokens', () => {
    for (const h of [null, '', 'Basic abc', TOKEN, 'Bearer ', 'Bearer wrong', `Bearer ${TOKEN}x`]) {
      expect(authorizeBenchmarkRequest(h, TOKEN)).toMatchObject({ ok: false, status: 401, code: 'UNAUTHORIZED' })
    }
  })
  it('accepts the exact token', () => {
    expect(authorizeBenchmarkRequest(`Bearer ${TOKEN}`, TOKEN)).toEqual({ ok: true })
  })
})

describe('validation', () => {
  const base = { operation: 'humanize', text: 'Some text here.' }
  it('accepts a minimal body with defaults', () => {
    const r = validateBenchmarkRequest(base)
    expect(r).toMatchObject({ ok: true, value: { settings: { intensity: 5, tone: 'balanced', domain: 'general', genre: null, audience: null }, candidateCountOverride: null } })
  })
  it.each([
    [null], [[]], [{ ...base, operation: 'nope' }], [{ ...base, text: '' }], [{ ...base, text: 5 }],
    [{ ...base, text: 'a'.repeat(50_001) }], [{ ...base, bogus: 1 }],
    [{ ...base, settings: { intensity: 5.5 } }], [{ ...base, settings: { intensity: 0 } }], [{ ...base, settings: { intensity: 11 } }],
    [{ ...base, settings: { tone: 'sarcastic' } }], [{ ...base, settings: { domain: 'x' } }],
    [{ ...base, settings: { genre: 'x' } }], [{ ...base, settings: { audience: 'x' } }],
    [{ ...base, candidateCountOverride: 0 }], [{ ...base, candidateCountOverride: 2.5 }],
    [{ ...base, extra: { sourceText: 3 } }], [{ ...base, extra: { tone: 'x' } }],
    [{ operation: 'repair_facts', text: 'abc' }],
  ])('rejects invalid body %#', (body) => {
    expect(validateBenchmarkRequest(body)).toMatchObject({ ok: false })
  })
  it('error messages never echo input text', () => {
    const r = validateBenchmarkRequest({ ...base, text: 'SECRET-INPUT', settings: { tone: 'SECRET-TONE' } })
    expect(JSON.stringify(r)).not.toContain('SECRET')
  })
})

describe('handleBenchmarkRun', () => {
  it('404 when feature off, 401 on bad token', async () => {
    delete process.env.HUMANITE_BENCHMARK_TOKEN
    expect((await handleBenchmarkRun(req({}), deps)).status).toBe(404)
    process.env.HUMANITE_BENCHMARK_TOKEN = TOKEN
    const res = await handleBenchmarkRun(req({}, { authorization: 'Bearer nope' }), deps)
    expect(res.status).toBe(401)
    expect((await res.json()).error.code).toBe('UNAUTHORIZED')
    expect(runHumaniteDocument).not.toHaveBeenCalled()
  })
  it('400 on invalid JSON and validation errors, 413 on oversized body', async () => {
    expect((await handleBenchmarkRun(req(null, undefined, '{nope'), deps)).status).toBe(400)
    const v = await handleBenchmarkRun(req({ operation: 'x', text: 'y' }), deps)
    expect(v.status).toBe(400)
    expect((await v.json()).error.code).toBe('VALIDATION_ERROR')
    expect((await handleBenchmarkRun(req(null, undefined, 'x'.repeat(300_000)), deps)).status).toBe(413)
  })

  it('humanize passes settings through to runHumaniteDocument', async () => {
    vi.mocked(runHumaniteDocument).mockResolvedValue({
      text: 'out', requestedIntensity: 9, appliedIntensity: 5, intensityCapped: true, modelUsed: 'm',
      modelCalls: 3, inputTokens: 10, outputTokens: 20, retryCount: 1, candidateCount: 2,
      chunkResult: { candidateSelection: { ranCandidateSearch: true, candidateCount: 2, disqualifiedAt: null }, gatesUnavailable: false, gate: { passed: true } },
    } as never)
    const res = await handleBenchmarkRun(req({
      operation: 'humanize', text: 'Hello there world.',
      settings: { intensity: 9, tone: 'formal', domain: 'legal', genre: null, audience: null }, candidateCountOverride: 1,
    }), deps)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ output: 'out', requestedIntensity: 9, appliedIntensity: 5, intensityCapped: true, candidateCount: 2, modelUsed: 'm', modelCalls: 3, inputTokens: 10, outputTokens: 20, retryCount: 1, gatesUnavailable: false, gatePassed: true })
    expect(typeof body.latencyMs).toBe('number')
    expect(runHumaniteDocument).toHaveBeenCalledWith(expect.objectContaining({
      sourceText: 'Hello there world.', requestedIntensity: 9, tone: 'formal', domain: 'legal', candidateCountOverride: 1, model: 'test-model',
    }))
  })

  it('repair_grammar calls repairGrammar on text', async () => {
    vi.mocked(repairGrammar).mockResolvedValue({ text: 'fixed', inputTokens: 4, outputTokens: 2 })
    const res = await handleBenchmarkRun(req({ operation: 'repair_grammar', text: 'he go home' }), deps)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ output: 'fixed', modelCalls: 1, inputTokens: 4, outputTokens: 2, retryCount: 0, appliedIntensity: null })
    expect(repairGrammar).toHaveBeenCalledWith(fakeClient.client, 'test-model', 'he go home')
  })

  it('repair_grammar with empty completion is 502', async () => {
    vi.mocked(repairGrammar).mockResolvedValue({ text: null, inputTokens: null, outputTokens: null })
    const res = await handleBenchmarkRun(req({ operation: 'repair_grammar', text: 'he go home' }), deps)
    expect(res.status).toBe(502)
  })

  it('repair_facts calls repairChunk(clean, corrupted, tone, domain)', async () => {
    vi.mocked(repairChunk).mockResolvedValue({ attempted: true, strategy: 'sentence_repair', succeeded: true, text: 'repaired', sentencesRepaired: 1, modelCalls: 2, inputTokens: 7, outputTokens: 3 })
    const res = await handleBenchmarkRun(req({
      operation: 'repair_facts', text: 'Revenue was 12%.', extra: { sourceText: 'Revenue was 15%.', domain: 'business' },
    }), deps)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ output: 'repaired', modelCalls: 2, gatePassed: true })
    expect(repairChunk).toHaveBeenCalledWith(fakeClient.client, 'test-model', 'Revenue was 15%.', 'Revenue was 12%.', 'balanced', 'business')
  })

  it('maps upstream errors without echoing the input or message', async () => {
    const secret = 'TOP-SECRET-INPUT'
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const mk = (status: number) => Object.assign(new Error(`failed on ${secret}`), { status })
    vi.mocked(repairGrammar).mockRejectedValueOnce(mk(500))
    let res = await handleBenchmarkRun(req({ operation: 'repair_grammar', text: secret }), deps)
    expect(res.status).toBe(502)
    const text = JSON.stringify(await res.json())
    expect(text).toContain('UPSTREAM_FAILED')
    expect(text).not.toContain(secret)
    vi.mocked(repairGrammar).mockRejectedValueOnce(mk(429))
    res = await handleBenchmarkRun(req({ operation: 'repair_grammar', text: secret }), deps)
    expect(res.status).toBe(429)
    vi.mocked(repairGrammar).mockRejectedValueOnce(new TypeError('bug'))
    res = await handleBenchmarkRun(req({ operation: 'repair_grammar', text: secret }), deps)
    expect(res.status).toBe(500)
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain(secret)
  })

  it('500 NOT_CONFIGURED when no provider key', async () => {
    const res = await handleBenchmarkRun(req({ operation: 'repair_grammar', text: 'abc def' }), { createClient: () => null })
    expect(res.status).toBe(500)
    expect((await res.json()).error.code).toBe('NOT_CONFIGURED')
  })
})

describe('handleBenchmarkHealth', () => {
  const hreq = (h?: string) => new Request('http://localhost/api/v1/benchmark/health', { headers: h ? { authorization: h } : {} })
  it('requires the token and lists operations', async () => {
    expect((await handleBenchmarkHealth(hreq())).status).toBe(401)
    const ok = await handleBenchmarkHealth(hreq(`Bearer ${TOKEN}`))
    expect(await ok.json()).toEqual({ ok: true, operations: ['humanize', 'repair_grammar', 'repair_facts'] })
    delete process.env.HUMANITE_BENCHMARK_TOKEN
    expect((await handleBenchmarkHealth(hreq(`Bearer ${TOKEN}`))).status).toBe(404)
  })
})

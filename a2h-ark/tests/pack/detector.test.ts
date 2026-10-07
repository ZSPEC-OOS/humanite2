import { afterAll, describe, expect, it } from 'vitest'
import type { ServiceAccess } from '@benchmarkr/contracts'
import { parseServiceRoleId } from '@benchmarkr/core'
import { baselineScore, detectText, normalizeDetectorResponse, resolveDetector } from '../../src/pack/detector'
import { DETECTOR_KEY, FakeMemo, ORIGIN_BATCH, startDetector } from './harness'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

const role = parseServiceRoleId('detector')
const services = (secret: unknown, bound = true): ServiceAccess => ({
  has: (r) => r === role && bound,
  resolve: () => Promise.resolve({ type: 'api_key' as never, secret: typeof secret === 'string' ? secret : JSON.stringify(secret) }),
})

describe('normalizeDetectorResponse', () => {
  it('maps the documented shape', () => {
    expect(normalizeDetectorResponse({ documents: [{ document_classification: 'MIXED', class_probabilities: { human: 0.3, ai: 0.4, mixed: 0.3 } }] }, 't')).toEqual({
      aiProbability: 0.4, humanProbability: 0.3, mixedProbability: 0.3, classification: 'mixed', analyzedAt: 't',
    })
  })
  it('maps the flat, minimal shape (AI probability and its complement)', () => {
    expect(normalizeDetectorResponse({ classification: 'ai', completely_generated_prob: 0.8 }, 't')).toEqual({
      aiProbability: 0.8, humanProbability: 0.2, mixedProbability: null, classification: 'ai-generated', analyzedAt: 't',
    })
  })
  it('is uncertain, never guessed, without a recognised class', () => {
    expect(normalizeDetectorResponse({ documents: [{}] }, 't').classification).toBe('uncertain')
    expect(normalizeDetectorResponse({ classification: 'weird' }, 't')).toMatchObject({ classification: 'uncertain', aiProbability: null })
    expect(() => normalizeDetectorResponse('nope', 't')).toThrow()
  })
})

describe('resolveDetector', () => {
  it('needs the role bound and a key', async () => {
    await expect(resolveDetector(services({ token: 'k' }, false))).rejects.toMatchObject({ code: 'FRAMEWORK_CONFIG' })
    await expect(resolveDetector(undefined)).rejects.toMatchObject({ code: 'FRAMEWORK_CONFIG' })
    await expect(resolveDetector(services({}))).rejects.toMatchObject({ code: 'FRAMEWORK_CONFIG' })
  })
  it('reads token or apiKey, a bare key, and an optional safe baseUrl', async () => {
    expect(await resolveDetector(services({ token: 'k1' }))).toMatchObject({ apiKey: 'k1', origin: 'https://api.gptzero.me', configId: 'gptzero-default' })
    expect(await resolveDetector(services({ apiKey: 'k2' }))).toMatchObject({ apiKey: 'k2' })
    expect(await resolveDetector(services('k3'))).toMatchObject({ apiKey: 'k3' })
    const compat = await resolveDetector(services({ token: 'k', baseUrl: 'https://detector.example/' }))
    expect(compat.origin).toBe('https://detector.example')
    expect(compat.configId).toMatch(/^compat-[0-9a-f]{12}$/)
    await expect(resolveDetector(services({ token: 'k', baseUrl: 'http://detector.example' }))).rejects.toMatchObject({ code: 'FRAMEWORK_CONFIG' })
  })
})

describe('detectText', () => {
  const started: Array<() => Promise<void>> = []
  afterAll(async () => {
    for (const stop of started) await stop()
  })

  it('scores a text with the key in X-API-Key and never sends it elsewhere', async () => {
    const d = await startDetector()
    started.push(d.close)
    const config = await resolveDetector(services({ token: DETECTOR_KEY, baseUrl: d.origin }))
    const score = await detectText('Researchers delve into it.', config, undefined)
    expect(score).toMatchObject({ classification: 'ai-generated', aiProbability: 0.92 })
    expect(d.requests[0]?.headers['x-api-key']).toBe(DETECTOR_KEY)
    expect(d.requests[0]?.body).toEqual({ document: 'Researchers delve into it.' })
  })

  it('retries rate limits and server errors with a bounded back-off, then fails without leaking the key or text', async () => {
    let calls = 0
    const flaky = createServer((req, res) => {
      req.resume()
      req.on('end', () => {
        calls += 1
        if (calls <= 2) {
          res.writeHead(calls === 1 ? 429 : 503, { 'retry-after': '0' }).end('{"message":"quoted document text"}')
        } else res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ documents: [{ document_classification: 'HUMAN_ONLY', class_probabilities: { ai: 0.1, human: 0.8, mixed: 0.1 } }] }))
      })
    })
    await new Promise<void>((r) => flaky.listen(0, '127.0.0.1', r))
    const origin = `http://127.0.0.1:${String((flaky.address() as AddressInfo).port)}`
    const config = { origin, apiKey: 'sekret-key', configId: 'c' }
    expect((await detectText('x', config, undefined, { baseDelayMs: 1 })).classification).toBe('human-written')
    expect(calls).toBe(3)
    calls = -100
    const error = await detectText('document body text', config, undefined, { attempts: 2, baseDelayMs: 1 }).catch((e: unknown) => e)
    expect(error).toMatchObject({ code: 'VERIFIER_ERROR' })
    const dump = `${String((error as Error).message)}${JSON.stringify(error)}`
    expect(dump).not.toContain('sekret-key')
    expect(dump).not.toContain('document body text')
    expect(dump).not.toContain('quoted document text')
    await new Promise<void>((r) => flaky.close(() => r()))
  })

  it('does not retry a rejected key', async () => {
    const d = await startDetector()
    started.push(d.close)
    const error = await detectText('x', { origin: d.origin, apiKey: 'wrong', configId: 'c' }, undefined, { baseDelayMs: 1 }).catch((e: unknown) => e)
    expect(error).toMatchObject({ code: 'FRAMEWORK_CONFIG', details: { status: 401 } })
    expect(d.requests).toHaveLength(0)
  })
})

describe('baselineScore', () => {
  it('computes once per (item hash, detector configuration) and reports the run that computed it', async () => {
    const d = await startDetector()
    const config = { origin: d.origin, apiKey: DETECTOR_KEY, configId: 'gptzero-default' }
    const memo = new FakeMemo(ORIGIN_BATCH)
    const first = await baselineScore(memo, 'hash-1', 'Researchers delve.', config, undefined, 'bat_current')
    const second = await baselineScore(memo, 'hash-1', 'Researchers delve.', config, undefined, 'bat_current')
    const other = await baselineScore(memo, 'hash-2', 'Researchers delve.', config, undefined, 'bat_current')
    expect([first.cached, second.cached, other.cached]).toEqual([false, true, false])
    expect(second.score).toMatchObject({ classification: 'ai-generated', runId: 'bat_firstrun' })
    expect(d.requests).toHaveLength(2)
    expect([...memo.store.keys()]).toEqual(['a2h.detector-baseline|hash-1:gptzero-default', 'a2h.detector-baseline|hash-2:gptzero-default'])
    // Without a memo it still scores, attributing the score to the current run.
    expect((await baselineScore(undefined, 'h', 'x', config, undefined, 'bat_current')).score.runId).toBe('bat_current')
    await d.close()
  })
})

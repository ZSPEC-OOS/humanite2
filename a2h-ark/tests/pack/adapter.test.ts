import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FrameworkError, parseCredentialId, type JsonObject } from '@benchmarkr/core'
import { createA2hTargetAdapter, parseCalls, parseConnectionConfig } from '../../src/pack/adapter'
import { createA2hBenchmarkPackage } from '../../src/pack/package'
import { CREDENTIAL_ID, TOKEN, execContext, makeEnv, plain, plan, context, type Env } from './harness'

const adapter = createA2hTargetAdapter()
const pkg = createA2hBenchmarkPackage()
let fx: Awaited<ReturnType<typeof makeEnv>>

beforeAll(async () => {
  fx = await makeEnv(pkg, adapter)
})
afterAll(async () => {
  await fx.stop()
})

const humanizeCall = (text = 'Researchers delve into the subject.', extra: Record<string, unknown> = {}) => ({
  operation: 'humanize',
  text,
  settings: { intensity: 7, tone: 'balanced', domain: 'legal' },
  ...extra,
})

async function runCalls(env: Env, calls: unknown[], attempt = 1) {
  const spec = {
    trialId: `tri_adapter_${String(attempt)}_${String(Math.random()).slice(2, 8)}`,
    batchId: 'bat_x',
    testId: 'A2H-01',
    trialIndex: 0,
    attempt,
    timeoutMs: 10_000,
    parameters: { calls },
    metadata: {},
  } as never
  const ctx = execContext(env)
  const prepared = await adapter.prepareTrial(ctx, spec)
  try {
    const handle = await adapter.startTrial(ctx, prepared)
    const raw = await adapter.collectResult(ctx, handle)
    return { raw, spec, ctx, prepared }
  } finally {
    await adapter.cleanupTrial(ctx, { trialId: (spec as { trialId: never }).trialId, state: prepared.state })
  }
}

describe('manifest and connection config', () => {
  it('declares the adapter id and a credential type', () => {
    expect(adapter.manifest()).toMatchObject({ adapterId: 'com.humanite.a2h-target', credentialTypes: ['humanite_service_token'] })
  })

  it('accepts a valid config and applies the default timeout', () => {
    const r = parseConnectionConfig({ baseUrl: 'https://humanite.example/', credentialId: CREDENTIAL_ID })
    expect(r).toEqual({ valid: true, value: { baseUrl: 'https://humanite.example', credentialId: CREDENTIAL_ID, requestTimeoutMs: 900_000 } })
  })

  it('rejects unknown settings, cleartext remote URLs, URL credentials, bad ids and bad timeouts', () => {
    const bad = (config: unknown): string[] => {
      const r = parseConnectionConfig(config)
      return r.valid ? [] : r.issues.map((i) => i.path)
    }
    expect(bad({ baseUrl: 'https://h.example', credentialId: CREDENTIAL_ID, token: 'x' })).toContain('token')
    expect(bad({ baseUrl: 'http://h.example', credentialId: CREDENTIAL_ID })).toContain('baseUrl')
    expect(bad({ baseUrl: 'https://u:p@h.example', credentialId: CREDENTIAL_ID })).toContain('baseUrl')
    expect(bad({ baseUrl: 'ftp://h.example', credentialId: CREDENTIAL_ID })).toContain('baseUrl')
    expect(bad({ baseUrl: 'https://h.example', credentialId: 'not-an-id' })).toContain('credentialId')
    expect(bad({ baseUrl: 'https://h.example' })).toContain('credentialId')
    expect(bad({ baseUrl: 'https://h.example', credentialId: CREDENTIAL_ID, requestTimeoutMs: 5 })).toContain('requestTimeoutMs')
    expect(bad(null)).toEqual([''])
    expect(parseConnectionConfig({ baseUrl: 'http://localhost:3000', credentialId: CREDENTIAL_ID }).valid).toBe(true)
  })

  it('checks the trial calls', () => {
    expect(() => parseCalls({})).toThrow(FrameworkError)
    expect(() => parseCalls({ calls: [] })).toThrow(FrameworkError)
    expect(() => parseCalls({ calls: [{ operation: 'nope', text: 'x' }] })).toThrow(FrameworkError)
    expect(() => parseCalls({ calls: [{ operation: 'humanize', text: '   ' }] })).toThrow(FrameworkError)
    expect(() => parseCalls({ calls: [{ operation: 'humanize', text: 'x', settings: { intensity: 'high' } }] })).toThrow(FrameworkError)
    expect(parseCalls({ calls: [humanizeCall()] } as unknown as JsonObject)).toHaveLength(1)
  })
})

describe('calls and telemetry', () => {
  it('sends the Bearer token and the documented body, and returns outputs with telemetry', async () => {
    const before = fx.humanite.requests.length
    const { raw } = await runCalls(fx.env, [humanizeCall('Researchers delve into the subject.', { candidateCountOverride: null })])
    const sent = fx.humanite.requests.slice(before)
    expect(sent).toHaveLength(1)
    expect(sent[0]?.headers.authorization).toBe(`Bearer ${TOKEN}`)
    expect(sent[0]?.body).toEqual({
      operation: 'humanize',
      text: 'Researchers delve into the subject.',
      settings: { intensity: 7, tone: 'balanced', domain: 'legal' },
      candidateCountOverride: null,
    })
    expect(raw.outcome).toBe('completed')
    const call = (raw.evidence['calls'] as Array<Record<string, unknown>>)[0]
    expect(call).toMatchObject({ operation: 'humanize', output: 'Researchers dig into the subject.', requestedIntensity: 7, appliedIntensity: 4, intensityCapped: true, modelUsed: 'fake-model-1', modelCalls: 2, retryCount: 1, latencyMs: 120 })
    expect(raw.metrics).toMatchObject({ latencyMs: 120, modelCalls: 2, inputTokens: 35, outputTokens: 35, retryCount: 1, callCount: 1, appliedIntensity: 4 })
    expect(Object.keys(raw.metrics)).toContain('roundTripMs')
  })

  it('returns both outputs of a two-call trial from one collectResult, summing the telemetry', async () => {
    const { raw } = await runCalls(fx.env, [humanizeCall('Researchers delve into it.'), humanizeCall('Numerous teams utilize it.')])
    const calls = raw.evidence['calls'] as Array<{ output: string }>
    expect(calls.map((c) => c.output)).toEqual(['Researchers dig into it.', 'Numerous teams use it.'])
    expect(raw.metrics).toMatchObject({ callCount: 2, latencyMs: 240, modelCalls: 4, retryCount: 2 })
  })

  it('routes repair operations with their extra inputs', async () => {
    const before = fx.humanite.requests.length
    const { raw } = await runCalls(fx.env, [{ operation: 'repair_facts', text: 'Store at 50 mg.', extra: { sourceText: 'Store at 5 mg.', tone: 'balanced', domain: 'medical' } }])
    expect(fx.humanite.requests.slice(before)[0]?.body).toMatchObject({ operation: 'repair_facts', extra: { sourceText: 'Store at 5 mg.', domain: 'medical' } })
    expect((raw.evidence['calls'] as Array<{ output: string }>)[0]?.output).toBe('Store at 5 mg.')
  })

  it('carries the optional A2H-15 telemetry when the endpoint sends it', async () => {
    const t = await makeEnv(pkg, adapter, { candidateSelection: true })
    const { raw } = await runCalls(t.env, [humanizeCall('Plain text here.')])
    expect((raw.evidence['calls'] as Array<Record<string, unknown>>)[0]).toMatchObject({ candidateSelection: { ranCandidateSearch: true, candidateCount: 2, disqualifiedAt: null }, gatesUnavailable: false, gatePassed: true })
    await t.stop()
  })

  it('releases a finished run, so the same trial attempt can run again', async () => {
    const spec = { trialId: 'tri_again', batchId: 'bat_x', testId: 'A2H-01', trialIndex: 0, attempt: 1, timeoutMs: 1000, parameters: { calls: [humanizeCall()] }, metadata: {} } as never
    const ctx = execContext(fx.env)
    for (let i = 0; i < 2; i += 1) {
      const prepared = await adapter.prepareTrial(ctx, spec)
      const handle = await adapter.startTrial(ctx, prepared)
      await adapter.collectResult(ctx, handle)
      await adapter.cleanupTrial(ctx, handle)
    }
  })
})

describe('error model', () => {
  const failing = async (options: Parameters<typeof makeEnv>[2], configOverride?: Record<string, unknown>) => {
    const t = await makeEnv(pkg, adapter, options)
    if (configOverride) t.env.configOverride = configOverride
    const secret = 'SECRET-TEXT-should-never-appear-in-errors'
    let error: unknown
    try {
      await runCalls(t.env, [humanizeCall(secret)])
    } catch (e) {
      error = e
    }
    const requests = t.humanite.requests.length
    await t.stop()
    return { error, requests, secret }
  }

  it('429 is retried inside the call, honouring Retry-After', async () => {
    const t = await makeEnv(pkg, adapter, { rateLimitFirst: 2 })
    const { raw } = await runCalls(t.env, [humanizeCall()])
    expect(raw.outcome).toBe('completed')
    expect(t.humanite.requests.length).toBe(3) // two 429s, then the answered request
    await t.stop()
  })

  it('a persistent 429 or any 5xx is a retryable connection failure', async () => {
    const limited = await failing({ rateLimitFirst: 99 })
    expect(limited.error).toMatchObject({ code: 'TARGET_CONNECTION' })
    const server = await failing({ failWith: 503 })
    expect(server.error).toMatchObject({ code: 'TARGET_CONNECTION', details: { status: 503, retryable: true } })
  })

  it('401, 403 and other 4xx are configuration errors that retrying cannot fix', async () => {
    const t = await makeEnv(pkg, adapter)
    t.env.configOverride = {}
    // A wrong token: resolve a credential whose token differs.
    const ctx = { ...execContext(t.env), credentials: { resolve: () => Promise.resolve({ type: 'humanite_service_token' as never, secret: JSON.stringify({ token: 'wrong-token' }) }) } }
    const spec = { trialId: 'tri_401', batchId: 'bat_x', testId: 'A2H-01', trialIndex: 0, attempt: 1, timeoutMs: 1000, parameters: { calls: [humanizeCall()] }, metadata: {} } as never
    const prepared = await adapter.prepareTrial(ctx, spec)
    await expect(adapter.startTrial(ctx, prepared)).rejects.toMatchObject({ code: 'FRAMEWORK_CONFIG', details: { status: 401 } })
    await adapter.cleanupTrial(ctx, { trialId: (spec as { trialId: never }).trialId, state: prepared.state })
    await t.stop()
    const other = await failing({ failWith: 422 })
    expect(other.error).toMatchObject({ code: 'FRAMEWORK_CONFIG', details: { status: 422 } })
  })

  it('an unusable answer or an unreachable server is a retryable connection failure', async () => {
    const bad = await failing({ malformed: true })
    expect(bad.error).toMatchObject({ code: 'TARGET_CONNECTION' })
    const t = await makeEnv(pkg, adapter)
    t.env.configOverride = { baseUrl: 'http://127.0.0.1:1' }
    await expect(runCalls(t.env, [humanizeCall()])).rejects.toMatchObject({ code: 'TARGET_CONNECTION' })
    await t.stop()
  })

  it('never puts the token, the server message or the text in an error', async () => {
    for (const options of [{ failWith: 500 }, { failWith: 400 }, { malformed: true }, { rateLimitFirst: 99 }]) {
      const { error, secret } = await failing(options)
      const dump = `${String((error as Error).message)} ${JSON.stringify(error)} ${String((error as Error).stack)}`
      expect(dump).not.toContain(TOKEN)
      expect(dump).not.toContain(secret)
      expect(dump).not.toContain('secret text')
    }
    // The server's own short error code may be named.
    const { error } = await failing({ failWith: 500 })
    expect((error as Error).message).toContain('BOOM')
  })

  it('a cancelled signal ends the run as cancelled', async () => {
    const t = await makeEnv(pkg, adapter)
    t.env.controller.abort()
    const { raw } = await runCalls(t.env, [humanizeCall()])
    expect(raw.outcome).toBe('cancelled')
    expect(t.humanite.requests).toHaveLength(0)
    await t.stop()
  })

  it('a failed run is released by cleanup', async () => {
    const t = await makeEnv(pkg, adapter, { failWith: 500 })
    const spec = { trialId: 'tri_fail', batchId: 'bat_x', testId: 'A2H-01', trialIndex: 0, attempt: 1, timeoutMs: 1000, parameters: { calls: [humanizeCall()] }, metadata: {} } as never
    const ctx = execContext(t.env)
    for (let i = 0; i < 2; i += 1) {
      const prepared = await adapter.prepareTrial(ctx, spec)
      await expect(adapter.startTrial(ctx, prepared)).rejects.toBeInstanceOf(FrameworkError)
      await adapter.cleanupTrial(ctx, { trialId: (spec as { trialId: never }).trialId, state: prepared.state })
    }
    await t.stop()
  })

  it('a credential the profile does not list is refused by the resolver, not worked around', async () => {
    const t = await makeEnv(pkg, adapter)
    t.env.configOverride = { credentialId: parseCredentialId('crd_other') }
    await expect(runCalls(t.env, [humanizeCall()])).rejects.toThrow()
    await t.stop()
  })
})

describe('connection test and capabilities', () => {
  it('is healthy when the endpoint authenticates and rejects the empty probe', async () => {
    const health = await adapter.testConnection(execContext(fx.env))
    expect(health.status).toBe('healthy')
    const caps = await adapter.getCapabilities(execContext(fx.env))
    expect(caps.capabilities).toEqual(['structured-task-execution', 'usage-metrics'])
  })

  it('is unreachable on a bad credential or a dead server', async () => {
    const ctx = { ...execContext(fx.env), credentials: { resolve: () => Promise.resolve({ type: 'x' as never, secret: 'plain-wrong-token' }) } }
    expect((await adapter.testConnection(ctx)).status).toBe('unreachable')
    const dead = await makeEnv(pkg, adapter)
    dead.env.configOverride = { baseUrl: 'http://127.0.0.1:1' }
    expect((await adapter.testConnection(execContext(dead.env))).status).toBe('unreachable')
    await dead.stop()
  })

  it('rejects an invalid stored config', async () => {
    const t = await makeEnv(pkg, adapter)
    t.env.configOverride = { baseUrl: 'http://remote.example' }
    await expect(adapter.testConnection(execContext(t.env))).rejects.toMatchObject({ code: 'FRAMEWORK_CONFIG' })
    await t.stop()
  })
})

describe('end to end through the package', () => {
  it('runs one planned trial with the adapter the way the pipeline does', async () => {
    fx.env.trialsPerTest = 10
    const total = await plan(fx.env, 'A2H-08')
    fx.env.planned = { 'A2H-08': total }
    const spec = plain(await pkg.createTrialSpec('A2H-08' as never, context(fx.env, 'A2H-08', 0)))
    const ctx = execContext(fx.env)
    const prepared = await adapter.prepareTrial(ctx, spec)
    const handle = await adapter.startTrial(ctx, prepared)
    const raw = await adapter.collectResult(ctx, handle)
    expect(raw.trialId).toBe(spec.trialId)
    await adapter.cleanupTrial(ctx, handle)
  })
})

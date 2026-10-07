// The target adapter 'com.humanite.a2h-target': drives Humanite's benchmark endpoint for the A2H benchmark.
//
// Connection config (non-secret, validated by `validateConnectionConfig`):
//   baseUrl           origin of Humanite, e.g. https://humanite.example (http only for localhost)
//   credentialId      id of the stored credential holding the Bearer service token (payload { token }); it must also
//                     be listed in the connection profile's credentialIds, which is what lets the runner resolve it
//   requestTimeoutMs  per-call timeout (default 900000)
//
// A trial's parameters are { calls: TargetCall[] } (see src/shared/targetCalls.ts): one call for most tests, two for
// A2H-11, A2H-14 and A2H-15. The calls run one after the other inside the trial. The raw result's evidence is
// { calls: [ { operation, output, ...what the endpoint reported } ] } and its metrics sum the telemetry. The adapter
// never scores. The token is resolved at the moment of use and is never logged, stored or put in an error.
import {
  FrameworkError,
  KNOWN_CAPABILITIES,
  parseCredentialId,
  parseArtifactId,
  sha256Hex,
  type JsonObject,
  type JsonValue,
  type MetricMap,
  type RawResultOutcome,
} from '@benchmarkr/core'
import {
  assertValidTargetAdapterManifest,
  type ConnectionHealth,
  type PreparedTargetRun,
  type TargetAdapter,
  type TargetCapabilities,
  type TargetExecutionContext,
  type TargetRawResult,
  type TargetRunHandle,
  type TargetRunState,
  type TrialSpec,
  type ValidationIssue,
  type ValidationResult,
} from '@benchmarkr/contracts'
import type { TargetCall } from '../shared/targetCalls'
import { callEndpoint, ENDPOINT_PATH, tokenFromSecret, type EndpointAnswer } from './endpoint'
import { linkedAbort, parseOrigin, postJson, TransportError } from './http'
import { ADAPTER_ID, configError, finite, isRecord, str, toJson } from './util'

export const TARGET_CREDENTIAL_TYPE = 'humanite_service_token'
const DEFAULT_REQUEST_TIMEOUT_MS = 900_000
const MAX_CALLS = 4
const MAX_TEXT_CHARS = 400_000
const OPERATIONS = ['humanize', 'repair_grammar', 'repair_facts'] as const

export interface A2hConnectionConfig {
  readonly baseUrl: string
  readonly credentialId: string
  readonly requestTimeoutMs: number
}

const CONFIG_KEYS = new Set(['baseUrl', 'credentialId', 'requestTimeoutMs'])

/** Strict validation of the connection config: unknown keys are rejected, the origin must be safe. */
export function parseConnectionConfig(config: unknown): ValidationResult<A2hConnectionConfig> {
  const issues: ValidationIssue[] = []
  if (!isRecord(config)) return { valid: false, issues: [{ path: '', message: 'the configuration must be an object' }] }
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.has(key)) issues.push({ path: key.slice(0, 40), message: 'unknown setting' })
  }
  let baseUrl = ''
  try {
    baseUrl = parseOrigin(config['baseUrl'], 'baseUrl')
  } catch (error) {
    issues.push({ path: 'baseUrl', message: error instanceof Error ? error.message : 'invalid' })
  }
  const credentialId = str(config['credentialId'])
  try {
    if (credentialId === undefined) throw new Error('missing')
    parseCredentialId(credentialId)
  } catch {
    issues.push({ path: 'credentialId', message: 'must be the id of a stored credential' })
  }
  const timeoutRaw = config['requestTimeoutMs']
  const requestTimeoutMs = timeoutRaw === undefined ? DEFAULT_REQUEST_TIMEOUT_MS : finite(timeoutRaw)
  if (requestTimeoutMs === undefined || !Number.isInteger(requestTimeoutMs) || requestTimeoutMs < 1_000 || requestTimeoutMs > 3_600_000) {
    issues.push({ path: 'requestTimeoutMs', message: 'must be an integer from 1000 to 3600000' })
  }
  if (issues.length > 0 || credentialId === undefined || requestTimeoutMs === undefined) return { valid: false, issues }
  return { valid: true, value: { baseUrl, credentialId, requestTimeoutMs } }
}

function configOf(context: TargetExecutionContext): A2hConnectionConfig {
  const parsed = parseConnectionConfig(context.connection.config)
  if (!parsed.valid) throw configError('Invalid A2H target connection configuration')
  return parsed.value
}

/** Checks the trial's calls; the adapter is generic over what it is asked to send, but strict about the shape. */
export function parseCalls(parameters: JsonObject): TargetCall[] {
  const raw = parameters['calls']
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_CALLS) {
    throw configError(`A trial needs 1 to ${String(MAX_CALLS)} calls`)
  }
  return raw.map((entry: unknown, index: number): TargetCall => {
    if (!isRecord(entry)) throw configError(`Call ${String(index)} is not an object`)
    const operation = entry['operation']
    if (!(OPERATIONS as readonly unknown[]).includes(operation)) throw configError(`Call ${String(index)} has an unknown operation`)
    const text = entry['text']
    if (typeof text !== 'string' || text.trim() === '' || text.length > MAX_TEXT_CHARS) {
      throw configError(`Call ${String(index)} needs non-empty text of at most ${String(MAX_TEXT_CHARS)} characters`)
    }
    const call: TargetCall = { operation: operation as TargetCall['operation'], text }
    if (entry['settings'] !== undefined) {
      const s = entry['settings']
      if (!isRecord(s) || finite(s['intensity']) === undefined || typeof s['tone'] !== 'string' || typeof s['domain'] !== 'string') {
        throw configError(`Call ${String(index)} has invalid settings`)
      }
      call.settings = s as unknown as NonNullable<TargetCall['settings']>
    }
    if (entry['candidateCountOverride'] !== undefined) call.candidateCountOverride = finite(entry['candidateCountOverride']) ?? null
    if (entry['extra'] !== undefined) {
      if (!isRecord(entry['extra'])) throw configError(`Call ${String(index)} has invalid extra`)
      call.extra = entry['extra']
    }
    return call
  })
}

type Phase = 'prepared' | 'running' | 'completed' | 'cancelled'

interface Run {
  readonly runId: string
  readonly trial: TrialSpec
  readonly config: A2hConnectionConfig
  readonly calls: readonly TargetCall[]
  phase: Phase
  controller: AbortController | undefined
  answers: EndpointAnswer[]
  startedAt: string
  finishedAt: string
  collected: boolean
  cleaned: boolean
}

const runIdFor = (trial: TrialSpec): string => `run_${sha256Hex(`${trial.trialId}|${String(trial.attempt)}`).slice(0, 16)}`

function evidenceOf(answer: EndpointAnswer, call: TargetCall): JsonObject {
  const entry: Record<string, JsonValue> = {
    operation: call.operation,
    output: answer.output,
    modelCalls: answer.modelCalls,
    inputTokens: answer.inputTokens,
    outputTokens: answer.outputTokens,
    retryCount: answer.retryCount,
    latencyMs: answer.latencyMs,
    roundTripMs: answer.roundTripMs,
  }
  if (answer.requestedIntensity !== undefined) entry['requestedIntensity'] = answer.requestedIntensity
  if (answer.appliedIntensity !== undefined) entry['appliedIntensity'] = answer.appliedIntensity
  if (answer.intensityCapped !== undefined) entry['intensityCapped'] = answer.intensityCapped
  if (answer.candidateCount !== undefined) entry['candidateCount'] = answer.candidateCount
  if (answer.modelUsed !== undefined) entry['modelUsed'] = answer.modelUsed
  if (answer.candidateSelection !== undefined) entry['candidateSelection'] = toJson(answer.candidateSelection)
  if (answer.gatesUnavailable !== undefined) entry['gatesUnavailable'] = answer.gatesUnavailable
  if (answer.gatePassed !== undefined) entry['gatePassed'] = answer.gatePassed
  return entry
}

/** Sums a telemetry field over the calls; absent (not zero) when no call reported it. */
function sumOf(answers: readonly EndpointAnswer[], pick: (a: EndpointAnswer) => number | null): number | undefined {
  const values = answers.map(pick).filter((v): v is number => v !== null)
  return values.length === 0 ? undefined : values.reduce((a, b) => a + b, 0)
}

function rawResultFor(run: Run): TargetRawResult {
  const outcome: RawResultOutcome = run.phase === 'completed' ? 'completed' : run.phase === 'cancelled' ? 'cancelled' : 'failed'
  const evidence: JsonObject = {
    runId: run.runId,
    calls: run.answers.map((answer, index) => evidenceOf(answer, run.calls[index] as TargetCall)),
  }
  const metrics: Record<string, number> = { callCount: run.answers.length }
  const entries: Array<[string, number | undefined]> = [
    ['latencyMs', sumOf(run.answers, (a) => a.latencyMs)],
    ['roundTripMs', sumOf(run.answers, (a) => a.roundTripMs)],
    ['modelCalls', sumOf(run.answers, (a) => a.modelCalls)],
    ['inputTokens', sumOf(run.answers, (a) => a.inputTokens)],
    ['outputTokens', sumOf(run.answers, (a) => a.outputTokens)],
    ['retryCount', sumOf(run.answers, (a) => a.retryCount)],
  ]
  for (const [name, value] of entries) if (value !== undefined) metrics[name] = value
  const first = run.answers[0]
  if (first?.appliedIntensity !== undefined) metrics['appliedIntensity'] = first.appliedIntensity
  const digest = sha256Hex(`${run.trial.trialId}|${String(run.trial.attempt)}|${run.answers.map((a) => a.output).join('\u0000')}`)
  return {
    trialId: run.trial.trialId,
    outcome,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    evidence,
    metrics: metrics as MetricMap,
    artifacts: [
      // The outputs are in the evidence; this fingerprint lets a report cite the exact text without carrying it.
      ...(outcome === 'completed'
        ? [
            {
              id: parseArtifactId(`art_${digest.slice(0, 16)}`),
              name: 'outputs.sha256',
              mediaType: 'text/plain',
              sizeBytes: 64,
              checksum: `sha256:${digest}`,
            },
          ]
        : []),
    ],
  }
}

export function createA2hTargetAdapter(options: { readonly version?: string } = {}): TargetAdapter {
  const manifest = assertValidTargetAdapterManifest({
    adapterId: ADAPTER_ID,
    name: 'Humanite benchmark endpoint',
    version: options.version ?? '1.0.0',
    frameworkApi: '>=1.0 <2.0',
    connectionSchemaVersion: 1,
    credentialTypes: [TARGET_CREDENTIAL_TYPE],
  })
  const runs = new Map<string, Run>()

  const lookup = (state: JsonObject): Run => {
    const runId = state['runId']
    const run = typeof runId === 'string' ? runs.get(runId) : undefined
    if (run === undefined) throw new FrameworkError('TARGET_EXECUTION', 'Unknown or already released run')
    return run
  }
  const release = (run: Run): void => {
    if (run.collected && run.cleaned) runs.delete(run.runId)
  }

  async function tokenOf(context: TargetExecutionContext, config: A2hConnectionConfig): Promise<string> {
    const resolved = await context.credentials.resolve(parseCredentialId(config.credentialId))
    const token = tokenFromSecret(resolved.secret)
    if (token === '') throw configError('The stored credential holds no token')
    return token
  }

  return {
    manifest: () => manifest,

    validateConnectionConfig: (config) => parseConnectionConfig(config),

    async testConnection(context): Promise<ConnectionHealth> {
      const config = configOf(context)
      const checkedAt = new Date().toISOString()
      const token = await tokenOf(context, config)
      const { controller, dispose } = linkedAbort(context.signal)
      const started = Date.now()
      try {
        // The contract has no health route, so the probe is a deliberately invalid request (an empty text): an
        // endpoint that is reachable and accepts the credential answers it with a validation error, which costs
        // nothing; 401/403 means the credential is wrong.
        const outcome = await postJson({
          url: `${config.baseUrl}${ENDPOINT_PATH}`,
          headers: { authorization: `Bearer ${token}` },
          body: { operation: 'repair_grammar', text: '' },
          timeoutMs: Math.min(config.requestTimeoutMs, 15_000),
          signal: controller.signal,
          maxResponseBytes: 64 * 1024,
        })
        const latencyMs = Date.now() - started
        if (outcome.status === 401 || outcome.status === 403) {
          return { status: 'unreachable', checkedAt, latencyMs, message: 'The endpoint rejected the credential' }
        }
        if (outcome.status === 404) return { status: 'unreachable', checkedAt, latencyMs, message: 'The benchmark endpoint was not found' }
        if (outcome.status === 429 || outcome.status >= 500) {
          return { status: 'degraded', checkedAt, latencyMs, message: `The endpoint answered HTTP ${String(outcome.status)}` }
        }
        return { status: 'healthy', checkedAt, latencyMs }
      } catch (error) {
        const kind = error instanceof TransportError ? error.kind : 'network'
        return { status: 'unreachable', checkedAt, message: `The endpoint could not be reached (${kind})` }
      } finally {
        dispose()
      }
    },

    getCapabilities: (context) =>
      Promise.resolve().then((): TargetCapabilities => {
        configOf(context)
        return {
          capabilities: [KNOWN_CAPABILITIES.STRUCTURED_TASK_EXECUTION, KNOWN_CAPABILITIES.USAGE_METRICS],
          details: { endpoint: 'humanite-benchmark-run' },
        }
      }),

    prepareTrial: (context, trial) =>
      Promise.resolve().then((): PreparedTargetRun => {
        const config = configOf(context)
        const calls = parseCalls(trial.parameters)
        const runId = runIdFor(trial)
        if (runs.has(runId)) throw new FrameworkError('TARGET_EXECUTION', 'A run for this trial attempt is already in progress')
        runs.set(runId, {
          runId,
          trial,
          config,
          calls,
          phase: 'prepared',
          controller: undefined,
          answers: [],
          startedAt: new Date().toISOString(),
          finishedAt: new Date().toISOString(),
          collected: false,
          cleaned: false,
        })
        return { trialId: trial.trialId, state: { runId } }
      }),

    // The calls run here, to completion: an adapter that offers neither streaming nor polling is taken to be
    // finished when startTrial returns.
    async startTrial(context, prepared): Promise<TargetRunHandle> {
      const run = lookup(prepared.state)
      if (run.phase !== 'prepared') throw new FrameworkError('TARGET_EXECUTION', 'Run was already started')
      const { controller, dispose } = linkedAbort(context.signal)
      run.controller = controller
      run.phase = 'running'
      run.startedAt = new Date().toISOString()
      try {
        const token = await tokenOf(context, run.config)
        for (const call of run.calls) {
          if (controller.signal.aborted) {
            run.phase = 'cancelled'
            break
          }
          const answer = await callEndpoint(
            call,
            { baseUrl: run.config.baseUrl, token, requestTimeoutMs: run.config.requestTimeoutMs },
            controller.signal,
          )
          run.answers.push(answer)
        }
        if (run.phase === 'running') run.phase = 'completed'
      } catch (error) {
        // A failed run is never collected: let cleanup release it.
        run.collected = true
        run.answers = []
        throw error
      } finally {
        run.finishedAt = new Date().toISOString()
        run.controller = undefined
        dispose()
      }
      return { trialId: run.trial.trialId, state: { runId: run.runId } }
    },

    pollTrial: (_context, handle) =>
      Promise.resolve().then((): TargetRunState => {
        const run = lookup(handle.state)
        const status = run.phase === 'prepared' ? 'pending' : run.phase
        return { status, observedAt: run.finishedAt }
      }),

    cancelTrial: (_context, handle) =>
      Promise.resolve().then((): void => {
        const run = lookup(handle.state)
        if (run.phase === 'running') {
          run.phase = 'cancelled'
          run.controller?.abort()
        }
      }),

    collectResult: (_context, handle) =>
      Promise.resolve().then((): TargetRawResult => {
        const run = lookup(handle.state)
        if (run.phase === 'running' || run.phase === 'prepared') throw new FrameworkError('TARGET_EXECUTION', 'Run has not finished')
        run.collected = true
        const result = rawResultFor(run)
        release(run)
        return result
      }),

    // Drops what the run holds (the outputs) as soon as the result has also been collected.
    cleanupTrial: (_context, handle) =>
      Promise.resolve().then((): void => {
        const runId = handle.state['runId']
        const run = typeof runId === 'string' ? runs.get(runId) : undefined
        if (run !== undefined) {
          run.cleaned = true
          if (!run.collected) run.answers = []
          release(run)
        }
      }),
  }
}

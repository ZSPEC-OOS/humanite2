// The client of Humanite's benchmark endpoint: POST {baseUrl}/api/v1/benchmark/run with a Bearer service token.
//
//   request : { operation, text, settings?, candidateCountOverride?, extra? }
//   200     : { output, requestedIntensity?, appliedIntensity?, intensityCapped?, candidateCount?, modelUsed?,
//               modelCalls, inputTokens, outputTokens, retryCount, latencyMs, candidateSelection?,
//               gatesUnavailable?, gatePassed? }
//   errors  : non-2xx with { error: { code, message } }
//
// Nothing here logs. Errors carry a status and the server's short error code, never the server's message, a
// header or any text.
import { FrameworkError } from '@benchmarkr/core'
import type { TargetCall } from '../shared/targetCalls'
import { failureFor, postJson, sleepAbortable, TransportError } from './http'
import { finite, isRecord, str } from './util'

export const ENDPOINT_PATH = '/api/v1/benchmark/run'

export interface EndpointClientOptions {
  /** Origin of Humanite (no path). */
  readonly baseUrl: string
  /** The Bearer service token. Held only for the duration of a call. */
  readonly token: string
  readonly requestTimeoutMs: number
  readonly maxResponseBytes?: number
  /** How many times a 429 is retried inside the call (honouring Retry-After, bounded). Default 2. */
  readonly maxRateLimitRetries?: number
  readonly maxRetryAfterMs?: number
}

/** A call's answer as the endpoint gave it, plus the round trip the client measured. */
export interface EndpointAnswer {
  readonly output: string
  readonly requestedIntensity?: number
  readonly appliedIntensity?: number
  readonly intensityCapped?: boolean
  readonly candidateCount?: number
  readonly modelUsed?: string
  readonly modelCalls: number | null
  readonly inputTokens: number | null
  readonly outputTokens: number | null
  readonly retryCount: number
  readonly latencyMs: number | null
  readonly candidateSelection?: Record<string, unknown> | null
  readonly gatesUnavailable?: boolean | null
  readonly gatePassed?: boolean | null
  readonly roundTripMs: number
}

function requestBody(call: TargetCall): Record<string, unknown> {
  const body: Record<string, unknown> = { operation: call.operation, text: call.text }
  if (call.settings !== undefined) body['settings'] = call.settings
  if (call.candidateCountOverride !== undefined) body['candidateCountOverride'] = call.candidateCountOverride
  if (call.extra !== undefined) body['extra'] = call.extra
  return body
}

function parseAnswer(body: unknown, roundTripMs: number): EndpointAnswer {
  if (!isRecord(body) || typeof body['output'] !== 'string') {
    throw new FrameworkError('TARGET_EXECUTION', 'The benchmark endpoint answered without an output')
  }
  const answer: { -readonly [K in keyof EndpointAnswer]: EndpointAnswer[K] } = {
    output: body['output'],
    modelCalls: finite(body['modelCalls']) ?? null,
    inputTokens: finite(body['inputTokens']) ?? null,
    outputTokens: finite(body['outputTokens']) ?? null,
    retryCount: finite(body['retryCount']) ?? 0,
    latencyMs: finite(body['latencyMs']) ?? null,
    roundTripMs,
  }
  const requested = finite(body['requestedIntensity'])
  if (requested !== undefined) answer.requestedIntensity = requested
  const applied = finite(body['appliedIntensity'])
  if (applied !== undefined) answer.appliedIntensity = applied
  if (typeof body['intensityCapped'] === 'boolean') answer.intensityCapped = body['intensityCapped']
  const candidates = finite(body['candidateCount'])
  if (candidates !== undefined) answer.candidateCount = candidates
  const model = str(body['modelUsed'])
  if (model !== undefined) answer.modelUsed = model
  if (body['candidateSelection'] === null) answer.candidateSelection = null
  else if (isRecord(body['candidateSelection'])) answer.candidateSelection = body['candidateSelection']
  if (typeof body['gatesUnavailable'] === 'boolean' || body['gatesUnavailable'] === null) answer.gatesUnavailable = body['gatesUnavailable']
  if (typeof body['gatePassed'] === 'boolean' || body['gatePassed'] === null) answer.gatePassed = body['gatePassed']
  return answer
}

/** One call to the benchmark endpoint. Throws FrameworkError (see `failureFor` for the classification). */
export async function callEndpoint(call: TargetCall, options: EndpointClientOptions, signal: AbortSignal): Promise<EndpointAnswer> {
  const retries = options.maxRateLimitRetries ?? 2
  const maxWait = options.maxRetryAfterMs ?? 30_000
  const url = `${options.baseUrl}${ENDPOINT_PATH}`
  for (let attempt = 0; ; attempt += 1) {
    const started = Date.now()
    let outcome
    try {
      outcome = await postJson({
        url,
        headers: { authorization: `Bearer ${options.token}` },
        body: requestBody(call),
        timeoutMs: options.requestTimeoutMs,
        signal,
        maxResponseBytes: options.maxResponseBytes ?? 8 * 1024 * 1024,
      })
    } catch (error) {
      if (error instanceof TransportError) throw failureFor('The benchmark endpoint', error.kind)
      throw error
    }
    if (outcome.status === 429 && attempt < retries && !signal.aborted) {
      await sleepAbortable(Math.min(outcome.retryAfterMs ?? 1000 * (attempt + 1), maxWait), signal)
      if (signal.aborted) throw failureFor('The benchmark endpoint', 'aborted')
      continue
    }
    if (outcome.status < 200 || outcome.status >= 300) throw failureFor('The benchmark endpoint', outcome.status, outcome.body)
    return parseAnswer(outcome.body, Date.now() - started)
  }
}

/** The token inside a stored credential payload (`token`, else `apiKey`/`serviceToken`), or the raw text. */
export function tokenFromSecret(secret: string): string {
  try {
    const parsed: unknown = JSON.parse(secret)
    if (typeof parsed === 'string') return parsed
    if (isRecord(parsed)) {
      for (const key of ['token', 'apiKey', 'serviceToken', 'key']) {
        const value = parsed[key]
        if (typeof value === 'string' && value !== '') return value
      }
    }
  } catch {
    // Not JSON: the secret is the token itself.
  }
  return secret
}

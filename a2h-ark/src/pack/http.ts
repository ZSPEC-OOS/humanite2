// A small, careful HTTP layer for the two services the pack talks to (Humanite's benchmark endpoint and the
// detector). It never logs, and no error it raises carries a request or response body, a header or a URL
// with credentials: only a status code and a short token from the server's own error code.
import { FrameworkError, type FrameworkErrorCode } from '@benchmarkr/core'
import { configError, isRecord, str } from './util'

/** A structural signal, as the framework hands to adapters and packages. */
export interface SignalLike {
  readonly aborted: boolean
  addEventListener(type: 'abort', listener: () => void, options?: { once?: boolean }): void
  removeEventListener(type: 'abort', listener: () => void): void
}

/** An AbortController that follows any number of structural signals. `dispose` detaches them. */
export function linkedAbort(...signals: Array<SignalLike | undefined>): { controller: AbortController; dispose: () => void } {
  const controller = new AbortController()
  const cleanups: Array<() => void> = []
  for (const signal of signals) {
    if (signal === undefined) continue
    if (signal.aborted) {
      controller.abort()
      continue
    }
    const onAbort = (): void => controller.abort()
    signal.addEventListener('abort', onAbort, { once: true })
    cleanups.push(() => signal.removeEventListener('abort', onAbort))
  }
  return { controller, dispose: () => cleanups.forEach((fn) => fn()) }
}

/** Sleeps, ending early (and quietly) when the signal aborts. */
export function sleepAbortable(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const done = (): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal.addEventListener('abort', done, { once: true })
  })
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

/**
 * A service origin: https anywhere, http only on the loopback interface (a bearer token must not cross a network
 * in clear text). Returns the origin without a trailing slash.
 */
export function parseOrigin(value: unknown, what: string): string {
  const raw = str(value)
  if (raw === undefined || raw.trim() === '') throw configError(`${what} must be a URL`)
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw configError(`${what} is not a valid URL`)
  }
  if (url.username !== '' || url.password !== '') throw configError(`${what} must not contain credentials`)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK.has(url.hostname))) {
    throw configError(`${what} must use https (http is allowed only for localhost)`)
  }
  return url.origin
}

export interface HttpOutcome {
  readonly status: number
  readonly retryAfterMs: number | undefined
  readonly body: unknown
}

export interface PostJsonOptions {
  readonly url: string
  readonly headers: Record<string, string>
  readonly body: unknown
  readonly timeoutMs: number
  readonly signal: AbortSignal
  readonly maxResponseBytes: number
}

/** Thrown for transport problems; carries no message from the network stack (it can quote URLs). */
export class TransportError extends Error {
  constructor(readonly kind: 'timeout' | 'network' | 'aborted' | 'too_large' | 'bad_json') {
    super(kind)
    this.name = 'TransportError'
  }
}

async function readLimited(response: Response, limit: number): Promise<string> {
  const reader = response.body?.getReader()
  if (reader === undefined) return ''
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > limit) {
      await reader.cancel().catch(() => undefined)
      throw new TransportError('too_large')
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

export function parseRetryAfter(header: string | null): number | undefined {
  if (header === null) return undefined
  const seconds = Number(header)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000)
  const date = Date.parse(header)
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now())
}

/** POSTs JSON and parses a JSON answer. Non-2xx answers are returned (not thrown) so callers can classify them. */
export async function postJson(options: PostJsonOptions): Promise<HttpOutcome> {
  const { controller, dispose } = linkedAbort(options.signal)
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, options.timeoutMs)
  try {
    let response: Response
    try {
      response = await fetch(options.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json', ...options.headers },
        body: JSON.stringify(options.body),
        signal: controller.signal,
        redirect: 'error',
      })
    } catch {
      throw new TransportError(timedOut ? 'timeout' : options.signal.aborted ? 'aborted' : 'network')
    }
    let text: string
    try {
      text = await readLimited(response, options.maxResponseBytes)
    } catch (error) {
      if (error instanceof TransportError) throw error
      throw new TransportError(timedOut ? 'timeout' : options.signal.aborted ? 'aborted' : 'network')
    }
    let body: unknown = undefined
    if (text !== '') {
      try {
        body = JSON.parse(text)
      } catch {
        if (response.ok) throw new TransportError('bad_json')
      }
    }
    return { status: response.status, retryAfterMs: parseRetryAfter(response.headers.get('retry-after')), body }
  } finally {
    clearTimeout(timer)
    dispose()
  }
}

/** The server's own error code when it is a short, safe token (never its message, which may quote the text). */
export function serverErrorCode(body: unknown): string | undefined {
  if (!isRecord(body)) return undefined
  const error = body['error']
  const code = isRecord(error) ? str(error['code']) : str(error)
  return code !== undefined && /^[A-Za-z0-9_.:-]{1,64}$/.test(code) ? code : undefined
}

/**
 * The adapter error model: 401/403 and other 4xx are configuration problems (retrying cannot help);
 * 408, 429, 5xx and transport failures are the connection's and may be retried by the runner.
 */
export function failureFor(
  who: string,
  status: number | 'timeout' | 'network' | 'aborted' | 'too_large' | 'bad_json',
  body?: unknown,
  retryCodeForServerErrors: FrameworkErrorCode = 'TARGET_CONNECTION',
): FrameworkError {
  const code = serverErrorCode(body)
  const suffix = code === undefined ? '' : ` (${code})`
  if (typeof status === 'number') {
    if (status === 401 || status === 403) {
      return new FrameworkError('FRAMEWORK_CONFIG', `${who} rejected the credential (HTTP ${String(status)})${suffix}`, {
        details: { status, reason: 'unauthorized' },
      })
    }
    if (status === 408 || status === 429 || status >= 500) {
      return new FrameworkError(retryCodeForServerErrors, `${who} is unavailable (HTTP ${String(status)})${suffix}`, {
        details: { status, retryable: true },
      })
    }
    return new FrameworkError('FRAMEWORK_CONFIG', `${who} refused the request (HTTP ${String(status)})${suffix}`, {
      details: { status },
    })
  }
  if (status === 'aborted') return new FrameworkError('CANCELLED', `The request to ${who} was cancelled`)
  if (status === 'timeout') return new FrameworkError(retryCodeForServerErrors, `The request to ${who} timed out`, { details: { retryable: true } })
  if (status === 'bad_json' || status === 'too_large') {
    return new FrameworkError(retryCodeForServerErrors, `${who} returned an unusable response (${status})`, { details: { retryable: true } })
  }
  return new FrameworkError(retryCodeForServerErrors, `${who} could not be reached`, { details: { retryable: true } })
}

/**
 * Service-caller authentication for the internal benchmark endpoints.
 *
 * SECURITY NOTE: the endpoints guarded by this module deliberately bypass
 * user auth, quota, billing and usage metering. They are meant for a single
 * trusted service caller (an external benchmarking framework) and are OFF
 * unless HUMANITE_BENCHMARK_TOKEN is set to a secret of at least
 * MIN_TOKEN_LENGTH characters. There is no default token.
 *
 * Plain functions only (no Next imports) so they are trivially unit-testable.
 */
import { createHash, timingSafeEqual } from 'crypto'

export const MIN_TOKEN_LENGTH = 32

export type AuthDecision =
  | { ok: true }
  | { ok: false; status: 404 | 401; code: 'NOT_FOUND' | 'UNAUTHORIZED'; message: string }

let misconfigLogged = false

/** Test hook: lets tests assert the one-time misconfiguration log line. */
export function resetAuthLogStateForTests(): void {
  misconfigLogged = false
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest()
}

function extractBearer(header: string | null | undefined): string | null {
  if (!header) return null
  const match = /^Bearer (.+)$/.exec(header.trim())
  return match?.[1] ?? null
}

export function authorizeBenchmarkRequest(
  authorizationHeader: string | null | undefined,
  configuredToken: string | undefined,
): AuthDecision {
  const off: AuthDecision = { ok: false, status: 404, code: 'NOT_FOUND', message: 'Not found.' }

  if (configuredToken === undefined || configuredToken === '') return off
  if (configuredToken.length < MIN_TOKEN_LENGTH) {
    // Misconfigured: behave exactly like "feature off". Never log the token.
    if (!misconfigLogged) {
      misconfigLogged = true
      console.error(`Benchmark service disabled: HUMANITE_BENCHMARK_TOKEN is shorter than ${MIN_TOKEN_LENGTH} characters.`)
    }
    return off
  }

  const presented = extractBearer(authorizationHeader)
  if (presented === null) {
    return { ok: false, status: 401, code: 'UNAUTHORIZED', message: 'Missing or invalid credentials.' }
  }
  // Compare fixed-length digests so timingSafeEqual never sees unequal
  // lengths and the comparison time does not depend on the token's content.
  const equal = timingSafeEqual(digest(presented), digest(configuredToken))
  if (!equal) return { ok: false, status: 401, code: 'UNAUTHORIZED', message: 'Missing or invalid credentials.' }
  return { ok: true }
}

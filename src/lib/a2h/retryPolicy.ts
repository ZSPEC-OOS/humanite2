// Phase 5 (§"Add controlled retries"): classifies a job failure as
// retryable (transient — worth paying for again) or permanent (a defect in
// this job's own inputs that retrying can never fix), and defines the
// bounded backoff schedule retryable failures use. Pure and dependency-free
// so it's trivially unit-testable against real error shapes without any
// Firestore or network mocking.

export type FailureClass = 'retryable' | 'permanent'

// Error constructor names this codebase (and the OpenAI SDK) actually
// throws for transient conditions — network drops, provider timeouts,
// rate limits, and 5xx responses. Anything else defaults to permanent: a
// job whose own data is bad (missing source, corrupt fixture, a validation
// error we raised ourselves) must never be retried into an infinite loop.
const RETRYABLE_ERROR_NAMES = new Set([
  'APIConnectionError',
  'APIConnectionTimeoutError',
  'APITimeoutError',
  'InternalServerError',
  'RateLimitError',
  'FetchError',
  'AbortError',
])

function hasStatusCode(err: unknown): err is { status: number } {
  return typeof err === 'object' && err != null && typeof (err as { status?: unknown }).status === 'number'
}

export function classifyFailure(err: unknown): FailureClass {
  if (hasStatusCode(err) && (err.status === 429 || err.status >= 500)) return 'retryable'
  if (err instanceof Error) {
    if (RETRYABLE_ERROR_NAMES.has(err.constructor.name)) return 'retryable'
    const message = err.message.toLowerCase()
    if (/\b(timeout|timed out|econnreset|econnrefused|network|socket hang up|fetch failed|enotfound|rate limit)\b/.test(message)) {
      return 'retryable'
    }
  }
  return 'permanent'
}

// Bounded exponential backoff: 30s, 2min, 10min for a job's 1st, 2nd, 3rd
// retryable failure respectively. A 4th retryable failure exhausts the
// schedule and becomes a permanent 'failed' — this is a ceiling on
// retryable attempts, not a promise every transient failure eventually
// succeeds.
export const BACKOFF_SCHEDULE_MS: readonly number[] = [30_000, 120_000, 600_000]
export const MAX_RETRYABLE_ATTEMPTS = BACKOFF_SCHEDULE_MS.length

// attemptCount is the 1-based count of attempts made so far, INCLUDING the
// one that just failed (matches BenchmarkJob.attemptCount, incremented at
// claim time) — returns null once the schedule is exhausted, meaning "stop
// retrying, mark permanently failed" regardless of failure class.
export function nextRetryDelayMs(attemptCount: number): number | null {
  const index = attemptCount - 1
  return index >= 0 && index < BACKOFF_SCHEDULE_MS.length ? BACKOFF_SCHEDULE_MS[index]! : null
}

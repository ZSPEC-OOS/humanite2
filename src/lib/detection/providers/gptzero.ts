import { DetectionOptions, DetectionProviderError } from '../contracts'
import { normalizeGPTZero } from '../normalize'
import { DetectionProvider, DetectionProviderResult } from './provider'

// Confirmed against GPTZero's published OpenAPI spec (api.gptzero.me/v2,
// X-API-Key header, { document } body) — see normalize.ts for the response
// field-naming uncertainty this provider stays tolerant of.
const ENDPOINT = 'https://api.gptzero.me/v2/predict/text'
const DEFAULT_TIMEOUT_MS = 30_000

// The permanent AI-detection backend. Deliberately does not forward the
// humanizer's mode/domain-hint options — GPTZero's API has no equivalent
// and always analyzes the full document — and never receives the
// humanizer's own API key, model, or provider: detection must not depend
// on, or be gradeable by, whatever produced the text.
export class GPTZeroProvider implements DetectionProvider {
  readonly id = 'gptzero'

  constructor(
    private readonly apiKey: string = process.env.GPTZERO_API_KEY ?? '',
    private readonly timeoutMs: number = Number(process.env.DETECTION_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
  ) {}

  async detect(text: string, _options?: DetectionOptions): Promise<DetectionProviderResult> {
    if (!this.apiKey) {
      throw new DetectionProviderError('PROVIDER_UNAUTHORIZED', 'GPTZERO_API_KEY is not configured.')
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)

    let response: Response
    try {
      response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          'X-API-Key': this.apiKey,
        },
        body: JSON.stringify({ document: text }),
        signal: controller.signal,
        cache: 'no-store',
      })
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new DetectionProviderError('PROVIDER_TIMEOUT', 'GPTZero request timed out.')
      }
      throw new DetectionProviderError('PROVIDER_UNAVAILABLE', 'GPTZero is unreachable.')
    } finally {
      clearTimeout(timeout)
    }

    if (!response.ok) {
      throw await mapGPTZeroError(response)
    }

    let raw: unknown
    try {
      raw = await response.json()
    } catch {
      throw new DetectionProviderError('INVALID_PROVIDER_RESPONSE', 'GPTZero returned a response that was not valid JSON.')
    }

    return normalizeGPTZero(raw, text)
  }
}

async function mapGPTZeroError(response: Response): Promise<DetectionProviderError> {
  let message = `GPTZero returned HTTP ${response.status}.`
  try {
    const body = await response.json()
    if (typeof body?.message === 'string') message = body.message
    else if (typeof body?.error === 'string') message = body.error
  } catch {
    // Response body wasn't JSON — keep the generic status-based message.
  }

  if (response.status === 401 || response.status === 403) {
    return new DetectionProviderError('PROVIDER_UNAUTHORIZED', message)
  }
  if (response.status === 429) {
    return new DetectionProviderError('PROVIDER_RATE_LIMITED', message)
  }
  if (response.status === 400) {
    return new DetectionProviderError('INVALID_INPUT', message)
  }
  if (response.status === 408 || response.status === 504) {
    return new DetectionProviderError('PROVIDER_TIMEOUT', message)
  }
  return new DetectionProviderError('PROVIDER_UNAVAILABLE', message)
}

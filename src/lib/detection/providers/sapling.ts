import { DetectionOptions, DetectionProviderError } from '../contracts'
import { normalizeSapling } from '../normalize'
import { DetectionProvider, DetectionProviderResult } from './provider'

// Confirmed via Sapling's published API docs (api.sapling.ai/api/v1/aidetect,
// POST body { key, text, sent_scores }) — see normalize.ts for the response
// shape this provider stays tolerant of (documented example: { score,
// sentence_scores: [{ score, sentence }] }, but per-field presence isn't
// guaranteed without a live key). The HTTP-status-to-error-code mapping below
// follows the same conventional REST assumptions GPTZeroProvider uses, since
// Sapling's docs don't publish an error-code table.
const ENDPOINT = 'https://api.sapling.ai/api/v1/aidetect'
const DEFAULT_TIMEOUT_MS = 30_000

// The metered AI-detection backend (selected via DETECTION_PROVIDER=sapling
// in gateway.ts). Deliberately does not forward the humanizer's mode/domain-
// hint options — Sapling's API has no equivalent — and never receives the
// humanizer's own API key, model, or provider: detection must not depend on,
// or be gradeable by, whatever produced the text.
export class SaplingProvider implements DetectionProvider {
  readonly id = 'sapling'

  constructor(
    private readonly apiKey: string = process.env.SAPLING_API_KEY ?? '',
    private readonly timeoutMs: number = Number(process.env.DETECTION_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS,
  ) {}

  async detect(text: string, _options?: DetectionOptions): Promise<DetectionProviderResult> {
    if (!this.apiKey) {
      throw new DetectionProviderError('PROVIDER_UNAUTHORIZED', 'SAPLING_API_KEY is not configured.')
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
        },
        body: JSON.stringify({ key: this.apiKey, text, sent_scores: true }),
        signal: controller.signal,
        cache: 'no-store',
      })
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new DetectionProviderError('PROVIDER_TIMEOUT', 'Sapling request timed out.')
      }
      throw new DetectionProviderError('PROVIDER_UNAVAILABLE', 'Sapling is unreachable.')
    } finally {
      clearTimeout(timeout)
    }

    if (!response.ok) {
      throw await mapSaplingError(response)
    }

    let raw: unknown
    try {
      raw = await response.json()
    } catch {
      throw new DetectionProviderError('INVALID_PROVIDER_RESPONSE', 'Sapling returned a response that was not valid JSON.')
    }

    return normalizeSapling(raw, text)
  }
}

async function mapSaplingError(response: Response): Promise<DetectionProviderError> {
  let message = `Sapling returned HTTP ${response.status}.`
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

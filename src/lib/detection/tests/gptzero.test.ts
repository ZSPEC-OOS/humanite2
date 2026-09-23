import { describe, it, expect, vi, afterEach } from 'vitest'
import { GPTZeroProvider } from '../providers/gptzero'
import { DetectionProviderError } from '../contracts'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('GPTZeroProvider', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('rejects with PROVIDER_UNAUTHORIZED when no API key is configured, without calling fetch', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const provider = new GPTZeroProvider('')
    await expect(provider.detect('some text')).rejects.toMatchObject({ code: 'PROVIDER_UNAUTHORIZED' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('sends the documented request shape', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse(200, { classification: 'human' }))
    vi.stubGlobal('fetch', fetchSpy)

    const provider = new GPTZeroProvider('test-key')
    await provider.detect('sample text')

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.gptzero.me/v2/predict/text',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'X-API-Key': 'test-key' }),
        body: JSON.stringify({ document: 'sample text' }),
      }),
    )
  })

  it('normalizes a successful response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      jsonResponse(200, { classification: 'ai', class_probabilities: { human: 0.05, ai: 0.9, mixed: 0.05 } }),
    ))

    const provider = new GPTZeroProvider('test-key')
    const result = await provider.detect('sample text')
    expect(result.classification).toBe('ai-generated')
    expect(result.provider).toEqual({ id: 'gptzero' })
  })

  it.each([
    [401, 'PROVIDER_UNAUTHORIZED'],
    [403, 'PROVIDER_UNAUTHORIZED'],
    [429, 'PROVIDER_RATE_LIMITED'],
    [400, 'INVALID_INPUT'],
    [408, 'PROVIDER_TIMEOUT'],
    [504, 'PROVIDER_TIMEOUT'],
    [500, 'PROVIDER_UNAVAILABLE'],
    [503, 'PROVIDER_UNAVAILABLE'],
  ] as const)('maps HTTP %s to %s', async (status, code) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(status, { message: 'boom' })))

    const provider = new GPTZeroProvider('test-key')
    await expect(provider.detect('sample text')).rejects.toMatchObject({ code })
  })

  it('maps a network failure to PROVIDER_UNAVAILABLE', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')))

    const provider = new GPTZeroProvider('test-key')
    await expect(provider.detect('sample text')).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' })
  })

  it('maps an aborted request to PROVIDER_TIMEOUT', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(
      Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }),
    ))

    const provider = new GPTZeroProvider('test-key')
    await expect(provider.detect('sample text')).rejects.toMatchObject({ code: 'PROVIDER_TIMEOUT' })
  })

  it('maps a malformed JSON body to INVALID_PROVIDER_RESPONSE', async () => {
    const response = new Response('not json', { status: 200 })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))

    const provider = new GPTZeroProvider('test-key')
    await expect(provider.detect('sample text')).rejects.toMatchObject({ code: 'INVALID_PROVIDER_RESPONSE' })
  })

  it('surfaces DetectionProviderError instances, not generic errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(500, {})))
    const provider = new GPTZeroProvider('test-key')
    await expect(provider.detect('sample text')).rejects.toBeInstanceOf(DetectionProviderError)
  })
})

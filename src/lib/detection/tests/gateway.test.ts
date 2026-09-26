import { describe, it, expect, afterEach, vi } from 'vitest'
import { getDetectionGateway, resetDetectionGatewayForTests } from '../gateway'

const ORIGINAL_ENV = { ...process.env }

function resetEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key]
  }
  Object.assign(process.env, ORIGINAL_ENV)
  vi.unstubAllEnvs()
  resetDetectionGatewayForTests()
}

describe('DetectionGateway', () => {
  afterEach(resetEnv)

  it('defaults to the mock provider when DETECTION_PROVIDER is unset', async () => {
    delete process.env.DETECTION_PROVIDER
    const result = await getDetectionGateway().detect('The first sentence. The second sentence.')
    expect(result.provider.id).toBe('mock')
  })

  it('respects MOCK_DETECTION_FIXTURE', async () => {
    delete process.env.DETECTION_PROVIDER
    process.env.MOCK_DETECTION_FIXTURE = 'ai'
    const result = await getDetectionGateway().detect('The first sentence. The second sentence.')
    expect(result.classification).toBe('ai-generated')
  })

  it('falls back to the human fixture for an unrecognized MOCK_DETECTION_FIXTURE', async () => {
    delete process.env.DETECTION_PROVIDER
    process.env.MOCK_DETECTION_FIXTURE = 'not-a-real-fixture'
    const result = await getDetectionGateway().detect('The first sentence. The second sentence.')
    expect(result.classification).toBe('human-written')
  })

  it('selects GPTZeroProvider when DETECTION_PROVIDER=gptzero', async () => {
    process.env.DETECTION_PROVIDER = 'gptzero'
    delete process.env.GPTZERO_API_KEY
    // No key configured — should fail as PROVIDER_UNAUTHORIZED rather than
    // silently falling back to mock, confirming the real provider was wired.
    await expect(getDetectionGateway().detect('some text')).rejects.toMatchObject({
      code: 'PROVIDER_UNAUTHORIZED',
    })
  })

  it('selects SaplingProvider when DETECTION_PROVIDER=sapling', async () => {
    process.env.DETECTION_PROVIDER = 'sapling'
    delete process.env.SAPLING_API_KEY
    // Same shape as the gptzero case above — no key configured should fail
    // as PROVIDER_UNAUTHORIZED rather than silently falling back to mock.
    await expect(getDetectionGateway().detect('some text')).rejects.toMatchObject({
      code: 'PROVIDER_UNAUTHORIZED',
    })
  })

  it('attaches processing_duration_ms and local diagnostics by default', async () => {
    delete process.env.DETECTION_PROVIDER
    delete process.env.LOCAL_DIAGNOSTICS_ENABLED
    const result = await getDetectionGateway().detect('The first sentence. The second sentence.')
    expect(result.processing_duration_ms).toBeGreaterThanOrEqual(0)
    expect(result.diagnostics).not.toBeNull()
    expect(result.diagnostics?.word_count).toBeGreaterThan(0)
  })

  it('omits diagnostics when LOCAL_DIAGNOSTICS_ENABLED=false', async () => {
    delete process.env.DETECTION_PROVIDER
    process.env.LOCAL_DIAGNOSTICS_ENABLED = 'false'
    const result = await getDetectionGateway().detect('The first sentence. The second sentence.')
    expect(result.diagnostics).toBeNull()
  })

  it('adds a short-text reliability warning under the word threshold', async () => {
    delete process.env.DETECTION_PROVIDER
    const result = await getDetectionGateway().detect('This was a great day.') // 5 words
    expect(result.warnings.some(w => /short/i.test(w) && /caution/i.test(w))).toBe(true)
  })

  it('does not add the short-text warning once a passage is long enough', async () => {
    delete process.env.DETECTION_PROVIDER
    const longText = 'This is a reasonably long sentence about nothing in particular. '.repeat(6) // 60+ words
    const result = await getDetectionGateway().detect(longText)
    expect(result.warnings.some(w => /short/i.test(w))).toBe(false)
  })

  it('the short-text warning is additive — it does not replace an existing provider warning', async () => {
    process.env.MOCK_DETECTION_FIXTURE = 'low-confidence'
    delete process.env.DETECTION_PROVIDER
    const result = await getDetectionGateway().detect('Too short.')
    expect(result.warnings.some(w => /low-confidence/i.test(w))).toBe(true)
    expect(result.warnings.some(w => /short/i.test(w) && /caution/i.test(w))).toBe(true)
  })

  it('still adds the short-text warning even when diagnostics are disabled — it does not depend on them', async () => {
    delete process.env.DETECTION_PROVIDER
    process.env.LOCAL_DIAGNOSTICS_ENABLED = 'false'
    const result = await getDetectionGateway().detect('This was a great day.')
    expect(result.diagnostics).toBeNull()
    expect(result.warnings.some(w => /short/i.test(w))).toBe(true)
  })

  it('memoizes the gateway across calls until reset', async () => {
    delete process.env.DETECTION_PROVIDER
    const first = getDetectionGateway()
    const second = getDetectionGateway()
    expect(first).toBe(second)
  })

  it('an apiKeyOverride always selects GPTZeroProvider, bypassing DETECTION_PROVIDER', () => {
    delete process.env.DETECTION_PROVIDER
    const gateway = getDetectionGateway('user-supplied-key')
    expect(gateway.providerId).toBe('gptzero')
  })

  it('an apiKeyOverride does not replace or read from the memoized default-gateway singleton', () => {
    delete process.env.DETECTION_PROVIDER
    const withoutOverride = getDetectionGateway()
    const withOverride = getDetectionGateway('user-supplied-key')
    const stillWithoutOverride = getDetectionGateway()
    expect(withoutOverride.providerId).toBe('mock')
    expect(withOverride.providerId).toBe('gptzero')
    expect(stillWithoutOverride).toBe(withoutOverride)
  })
})

describe('DetectionGateway — production fails closed on a misconfigured mock fallback', () => {
  afterEach(resetEnv)

  it('refuses to build the mock provider in production without an explicit opt-out', () => {
    vi.stubEnv('NODE_ENV', 'production')
    delete process.env.DETECTION_PROVIDER
    delete process.env.ALLOW_MOCK_DETECTION
    expect(() => getDetectionGateway()).toThrow(/not configured for production/i)
  })

  it('still refuses when DETECTION_PROVIDER is set to something other than "gptzero"', () => {
    vi.stubEnv('NODE_ENV', 'production')
    process.env.DETECTION_PROVIDER = 'mock'
    delete process.env.ALLOW_MOCK_DETECTION
    expect(() => getDetectionGateway()).toThrow(/not configured for production/i)
  })

  it('allows the mock provider in production when ALLOW_MOCK_DETECTION=true', () => {
    vi.stubEnv('NODE_ENV', 'production')
    delete process.env.DETECTION_PROVIDER
    process.env.ALLOW_MOCK_DETECTION = 'true'
    expect(getDetectionGateway().providerId).toBe('mock')
  })

  it('still selects the real provider in production when DETECTION_PROVIDER=gptzero', () => {
    vi.stubEnv('NODE_ENV', 'production')
    process.env.DETECTION_PROVIDER = 'gptzero'
    expect(getDetectionGateway().providerId).toBe('gptzero')
  })

  it('still selects the real provider in production when DETECTION_PROVIDER=sapling', () => {
    vi.stubEnv('NODE_ENV', 'production')
    process.env.DETECTION_PROVIDER = 'sapling'
    expect(getDetectionGateway().providerId).toBe('sapling')
  })

  it('a caller-supplied apiKeyOverride bypasses the production guard entirely', () => {
    vi.stubEnv('NODE_ENV', 'production')
    delete process.env.DETECTION_PROVIDER
    delete process.env.ALLOW_MOCK_DETECTION
    expect(getDetectionGateway('user-supplied-key').providerId).toBe('gptzero')
  })

  it('does not affect non-production environments (e.g. test/dev)', () => {
    vi.stubEnv('NODE_ENV', 'test')
    delete process.env.DETECTION_PROVIDER
    delete process.env.ALLOW_MOCK_DETECTION
    expect(getDetectionGateway().providerId).toBe('mock')
  })

  it('the failed build never poisons the singleton — a later valid config still works', () => {
    vi.stubEnv('NODE_ENV', 'production')
    delete process.env.DETECTION_PROVIDER
    delete process.env.ALLOW_MOCK_DETECTION
    expect(() => getDetectionGateway()).toThrow()

    process.env.DETECTION_PROVIDER = 'gptzero'
    expect(getDetectionGateway().providerId).toBe('gptzero')
  })
})

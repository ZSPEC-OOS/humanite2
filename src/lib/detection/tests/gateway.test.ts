import { describe, it, expect, afterEach } from 'vitest'
import { getDetectionGateway, resetDetectionGatewayForTests } from '../gateway'

const ORIGINAL_ENV = { ...process.env }

function resetEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key]
  }
  Object.assign(process.env, ORIGINAL_ENV)
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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { DetectionResult } from '../contracts'
import type { DetectionGateway } from '../gateway'

const { docStore } = vi.hoisted(() => ({ docStore: new Map<string, unknown>() }))

vi.mock('@/lib/firestore', () => ({
  db: () => ({
    collection: () => ({
      doc: (key: string) => ({
        get: async () => ({
          exists: docStore.has(key),
          data: () => docStore.get(key),
        }),
        set: async (value: unknown) => {
          docStore.set(key, value)
        },
      }),
    }),
  }),
  tryPersist: async (op: () => Promise<unknown>) => {
    await op()
    return true
  },
}))

const { getCachedScanResult, hashScanInput, setCachedScanResult, detectWithCache } = await import('../dedupe')

const ORIGINAL_ENV = { ...process.env }

function resetEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key]
  }
  Object.assign(process.env, ORIGINAL_ENV)
}

function makeResult(overrides: Partial<DetectionResult> = {}): DetectionResult {
  return {
    schema_version: '3.0',
    provider: { id: 'mock' },
    classification: 'human-written',
    probabilities: { human: 0.9, ai: 0.08, mixed: 0.02 },
    predicted_class_probability: 0.9,
    confidence_category: 'high',
    estimated_ai_like_fraction: 0.08,
    segments: [],
    diagnostics: null,
    processing_duration_ms: 12,
    warnings: [],
    explanation: { summary: 'ok' },
    ...overrides,
  }
}

describe('hashScanInput', () => {
  it('is deterministic for the same text and provider', () => {
    expect(hashScanInput('hello world', 'gptzero')).toBe(hashScanInput('hello world', 'gptzero'))
  })

  it('differs by provider so a cached result never crosses providers', () => {
    expect(hashScanInput('hello world', 'gptzero')).not.toBe(hashScanInput('hello world', 'mock'))
  })

  it('differs by text', () => {
    expect(hashScanInput('hello world', 'mock')).not.toBe(hashScanInput('goodbye world', 'mock'))
  })
})

describe('getCachedScanResult / setCachedScanResult', () => {
  beforeEach(() => {
    docStore.clear()
    resetEnv()
  })
  afterEach(resetEnv)

  it('returns null on a cache miss', async () => {
    expect(await getCachedScanResult('nonexistent-key')).toBeNull()
  })

  it('returns the stored result on a cache hit', async () => {
    const key = hashScanInput('some text', 'mock')
    const result = makeResult()
    await setCachedScanResult(key, result)
    expect(await getCachedScanResult(key)).toEqual(result)
  })

  it('treats an expired entry as a miss', async () => {
    process.env.SCAN_CACHE_TTL_SECONDS = '10'
    const key = hashScanInput('some text', 'mock')
    await setCachedScanResult(key, makeResult())
    // Backdate the cached entry past the 10s TTL.
    const stored = docStore.get(key) as { cachedAt: number }
    stored.cachedAt = Date.now() - 20_000
    expect(await getCachedScanResult(key)).toBeNull()
  })

  it('respects a custom SCAN_CACHE_TTL_SECONDS', async () => {
    process.env.SCAN_CACHE_TTL_SECONDS = '3600'
    const key = hashScanInput('some text', 'mock')
    await setCachedScanResult(key, makeResult())
    const stored = docStore.get(key) as { cachedAt: number }
    stored.cachedAt = Date.now() - 1_800_000 // 30 minutes ago — within 1h TTL
    expect(await getCachedScanResult(key)).not.toBeNull()
  })
})

// detectWithCache is the single reuse-or-pay-again decision point shared by
// the manual /v1/scan route and the automatic post-humanize scan — these
// lock in that both call sites behave identically through it.

function fakeGateway(providerId: string, result: DetectionResult) {
  const detect = vi.fn().mockResolvedValue(result)
  return { gateway: { providerId, detect } as unknown as DetectionGateway, detect }
}

describe('detectWithCache', () => {
  beforeEach(() => {
    docStore.clear()
    resetEnv()
  })
  afterEach(resetEnv)

  it('calls the provider and caches the result on a cache miss', async () => {
    const { gateway, detect } = fakeGateway('mock', makeResult({ classification: 'ai-generated' }))
    const { result, cacheHit } = await detectWithCache(gateway, 'some text', { mode: 'standard' }, false)
    expect(cacheHit).toBe(false)
    expect(result.classification).toBe('ai-generated')
    expect(detect).toHaveBeenCalledTimes(1)

    // The cache now has an entry a second call for the same text should hit.
    const key = hashScanInput('some text', 'mock')
    expect(await getCachedScanResult(key)).not.toBeNull()
  })

  it('reuses a cached result instead of calling the provider again for the same text', async () => {
    const { gateway, detect } = fakeGateway('mock', makeResult())
    await detectWithCache(gateway, 'identical text', undefined, false)
    const { result, cacheHit } = await detectWithCache(gateway, 'identical text', undefined, false)
    expect(cacheHit).toBe(true)
    expect(result).toEqual(makeResult())
    // The whole point — a second call for unchanged text must not pay twice.
    expect(detect).toHaveBeenCalledTimes(1)
  })

  it('bypasses the cache entirely when bypassCache is true, even for text scanned before', async () => {
    const { gateway, detect } = fakeGateway('gptzero', makeResult())
    await detectWithCache(gateway, 'shared text', undefined, false) // populates the shared cache
    const { cacheHit } = await detectWithCache(gateway, 'shared text', undefined, true) // BYOK caller
    expect(cacheHit).toBe(false)
    expect(detect).toHaveBeenCalledTimes(2)
  })

  it('does not write to the cache when bypassCache is true', async () => {
    const { gateway } = fakeGateway('gptzero', makeResult())
    await detectWithCache(gateway, 'byok text', undefined, true)
    const key = hashScanInput('byok text', 'gptzero')
    expect(await getCachedScanResult(key)).toBeNull()
  })
})

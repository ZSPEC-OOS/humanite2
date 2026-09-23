import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { DetectionResult } from '../contracts'

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

const { getCachedScanResult, hashScanInput, setCachedScanResult } = await import('../dedupe')

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

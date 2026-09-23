import { createHash } from 'crypto'
import { db, tryPersist } from '@/lib/firestore'
import type { DetectionResult } from './contracts'

// Matches the retired proprietary scanner's own cache policy (24h) — scan
// results for identical text are stable, and reusing them saves a real
// GPTZero request.
const DEFAULT_CACHE_TTL_SECONDS = 86_400

function cacheTtlSeconds(): number {
  const raw = Number(process.env.SCAN_CACHE_TTL_SECONDS)
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_CACHE_TTL_SECONDS
}

// Keyed by provider as well as text — a cached GPTZero result must never be
// served back for a mock-provider request, or (once a real key is added) a
// stale mock result served in GPTZero's place.
export function hashScanInput(text: string, providerId: string): string {
  return createHash('sha256').update(`${providerId}:${text}`).digest('hex')
}

interface CacheRecord {
  result: DetectionResult
  cachedAt: number
}

export async function getCachedScanResult(cacheKey: string): Promise<DetectionResult | null> {
  try {
    const doc = await db().collection('scanCache').doc(cacheKey).get()
    if (!doc.exists) return null
    const data = doc.data() as CacheRecord
    const ageSeconds = (Date.now() - data.cachedAt) / 1000
    if (ageSeconds > cacheTtlSeconds()) return null
    return data.result
  } catch (err) {
    console.warn('Scan cache lookup unavailable — proceeding without it', {
      type: err instanceof Error ? err.constructor.name : typeof err,
    })
    return null
  }
}

export async function setCachedScanResult(cacheKey: string, result: DetectionResult): Promise<void> {
  await tryPersist(
    () => db().collection('scanCache').doc(cacheKey).set({ result, cachedAt: Date.now() } satisfies CacheRecord),
    'cache scan result',
  )
}

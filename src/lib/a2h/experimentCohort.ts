import type { Firestore } from 'firebase-admin/firestore'
import { createHash } from 'crypto'
import { A2H_COLLECTIONS, type A2HTestCode, type BenchmarkExperimentCohort, type BenchmarkRunSource } from './types'

const COLLECTION = A2H_COLLECTIONS.experimentCohorts

function cohortId(runId: string, benchmarkCode: A2HTestCode): string {
  return `${runId}__${benchmarkCode}`
}

export async function getExperimentCohort(firestore: Firestore, runId: string, benchmarkCode: A2HTestCode): Promise<BenchmarkExperimentCohort | null> {
  const doc = await firestore.collection(COLLECTION).doc(cohortId(runId, benchmarkCode)).get()
  return doc.exists ? (doc.data() as BenchmarkExperimentCohort) : null
}

// A small, seedable, dependency-free PRNG (mulberry32) — deterministic given
// the same numeric seed, so the same samplingSeed string always produces the
// same shuffle/sample. Not cryptographic; only needs to be reproducible.
function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function seedToInt(seed: string): number {
  const hash = createHash('sha256').update(seed).digest()
  return hash.readUInt32BE(0)
}

// Deterministic stratified sample (§40): groups the run's cohort by domain
// and takes a proportional share of each domain rather than a single global
// shuffle, so a small sample still covers every selected domain rather than
// happening to draw entirely from one. `sampleSize === null` returns every
// source (no sampling) — the same seed and input always produce the same
// selection, so this must never be called more than once per run/test (see
// setExperimentCohort's write-once behavior below).
export function stratifiedSample(sources: BenchmarkRunSource[], sampleSize: number | null, seed: string): string[] {
  const sorted = [...sources].sort((a, b) => a.sourceId.localeCompare(b.sourceId))
  if (sampleSize == null || sampleSize >= sorted.length) return sorted.map(s => s.sourceId)

  const rng = mulberry32(seedToInt(seed))
  const byDomain = new Map<string, BenchmarkRunSource[]>()
  for (const s of sorted) {
    const list = byDomain.get(s.domainId) ?? []
    list.push(s)
    byDomain.set(s.domainId, list)
  }

  function shuffle<T>(items: T[]): T[] {
    const arr = [...items]
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      ;[arr[i], arr[j]] = [arr[j]!, arr[i]!]
    }
    return arr
  }

  // Largest-remainder method: each domain's exact proportional share is
  // split into a floor (guaranteed) and a fractional remainder; leftover
  // slots (sampleSize minus the sum of floors) go to the domains with the
  // largest remainders, so the total always sums to exactly sampleSize
  // (never less), and every domain gets at least a proportional look-in.
  const domains = [...byDomain.keys()].sort()
  const shuffled = new Map(domains.map(d => [d, shuffle(byDomain.get(d)!)]))
  const exact = domains.map(d => (sampleSize * shuffled.get(d)!.length) / sorted.length)
  const floors = exact.map(Math.floor)
  let leftover = sampleSize - floors.reduce((a, b) => a + b, 0)
  const remainders = domains.map((d, i) => ({ i, remainder: exact[i]! - floors[i]! }))
    .sort((a, b) => b.remainder - a.remainder || domains[a.i]!.localeCompare(domains[b.i]!))
  const quotas = [...floors]
  for (const { i } of remainders) {
    if (leftover <= 0) break
    if (quotas[i]! < shuffled.get(domains[i]!)!.length) {
      quotas[i]!++
      leftover--
    }
  }

  const selected: string[] = []
  domains.forEach((d, i) => selected.push(...shuffled.get(d)!.slice(0, quotas[i]).map(s => s.sourceId)))
  return selected.sort()
}

// Write-once (§41): an existing cohort for this (run, benchmarkCode) is
// returned as-is — historical test cohorts must never shift, even if
// re-validation is somehow triggered twice.
export async function getOrCreateExperimentCohort(
  firestore: Firestore,
  runId: string,
  benchmarkCode: A2HTestCode,
  allSources: BenchmarkRunSource[],
  sampleSize: number | null,
): Promise<BenchmarkExperimentCohort> {
  const existing = await getExperimentCohort(firestore, runId, benchmarkCode)
  if (existing) return existing

  const samplingSeed = `${runId}__${benchmarkCode}`
  const sourceIds = stratifiedSample(allSources, sampleSize, samplingSeed)
  const cohort: BenchmarkExperimentCohort = {
    id: cohortId(runId, benchmarkCode),
    runId,
    benchmarkCode,
    sourceIds,
    samplingSeed,
    createdAt: new Date().toISOString(),
  }
  await firestore.collection(COLLECTION).doc(cohort.id).set(cohort)
  return cohort
}

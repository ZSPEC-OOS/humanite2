import { createHash } from 'crypto'
import type { BenchmarkRunSource } from '../shared/types'

// Pure selection logic of Humanite's experimentCohort.ts (the Firestore write-once persistence is
// not ported: the caller must compute the cohort once per run/test and keep it).

// The sampling seed Humanite derived for a (run, test) cohort.
export function experimentCohortSeed(runId: string, benchmarkCode: string): string {
  return `${runId}__${benchmarkCode}`
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

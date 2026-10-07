// Trial planning: which items a test measures and how the trial index maps onto (item, cell).
//
// The operator's `trialsPerTest` is a budget. A test's trials are `items x cells` (cells: intensities, repeats,
// contrasts or arms), so the planned count is the largest whole number of items that fits the budget (at least one
// item, at most Benchmarkr's per-test limit of 20 000 trials). The items are chosen by seeded, stratified sampling
// (domains, then lengths, then a draw inside every cell) from the pool the test needs, with the seed derived from
// the dataset fingerprints: the same bound datasets and the same budget always give the same trials.
import type { DatasetAccess } from '@benchmarkr/contracts'
import { sha256Hex } from '@benchmarkr/core'
import { CORPUS_INPUT, FIXTURES_INPUT, corpusIndex, fixtureIndex, selectEntries, type PoolEntry } from './data'
import { configError } from './util'
import type { Design } from './suite'

/** Benchmarkr's limit on the trials of one test. */
export const MAX_TRIALS_PER_TEST = 20_000

export interface Selection {
  readonly entries: readonly PoolEntry[]
  readonly cells: number
  readonly total: number
}

export function itemCountFor(design: Design, budget: number, poolSize: number): number {
  const byBudget = Math.max(1, Math.floor(budget / design.cells))
  const byLimit = Math.max(1, Math.floor(MAX_TRIALS_PER_TEST / design.cells))
  return Math.min(poolSize, byBudget, byLimit)
}

async function poolFor(design: Design, datasets: DatasetAccess): Promise<PoolEntry[]> {
  const corpus = await corpusIndex(datasets)
  if (design.pool === 'corpus') return [...corpus.entries]
  if (design.fixtureType === undefined) throw configError('This test is missing its fixture type')
  if (!datasets.has(FIXTURES_INPUT)) {
    throw configError(`This test needs the fixtures dataset (${design.fixtureType} fixtures); none is bound`)
  }
  const fixtures = await fixtureIndex(datasets)
  const ofType = fixtures.byType.get(design.fixtureType) ?? []
  if (design.pool === 'corpus-with-fixtures') {
    const sources = new Set(ofType.map((f) => f.sourceId))
    const pool = corpus.entries.filter((e) => sources.has(e.key))
    if (pool.length === 0) throw configError(`The fixtures dataset has no ${design.fixtureType} fixture for any corpus source`)
    return pool
  }
  // 'fixtures': one entry per fixture (repair tests), stratified by the fixture's source domain and length.
  const pool: PoolEntry[] = []
  ofType.forEach((fixture, index) => {
    const source = corpus.byKey.get(fixture.sourceId)
    pool.push({ key: fixture.key, index, domain: fixture.domain ?? source?.domain ?? 'unknown', words: fixture.words ?? source?.words ?? 0 })
  })
  if (pool.length === 0) throw configError(`The fixtures dataset has no ${design.fixtureType} fixture`)
  return pool
}

const cache = new Map<string, Promise<Selection>>()

/**
 * The selection for a design and item count. `itemCount` undefined derives it from `budget`. Cached by dataset
 * fingerprints (published versions never change).
 */
export function selectionFor(design: Design, datasets: DatasetAccess, budget: number, itemCount?: number): Promise<Selection> {
  if (design.pool === 'none') return Promise.resolve({ entries: [], cells: design.cells, total: 0 })
  if (!datasets.has(CORPUS_INPUT)) return Promise.reject(configError('The corpus dataset is not bound'))
  const fingerprints = `${datasets.fingerprint(CORPUS_INPUT)}|${datasets.has(FIXTURES_INPUT) ? datasets.fingerprint(FIXTURES_INPUT) : ''}`
  const key = `${fingerprints}|${design.pool}|${design.fixtureType ?? ''}|${design.cohort}|${String(design.cells)}|${itemCount === undefined ? `b${String(budget)}` : `n${String(itemCount)}`}`
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  const made = (async (): Promise<Selection> => {
    const pool = await poolFor(design, datasets)
    const count = itemCount ?? itemCountFor(design, budget, pool.length)
    const seed = sha256Hex(`${fingerprints}|${design.cohort}|${design.fixtureType ?? ''}`).slice(0, 24)
    const entries = selectEntries(pool, Math.min(count, pool.length), seed)
    return { entries, cells: design.cells, total: entries.length * design.cells }
  })()
  made.catch(() => cache.delete(key))
  cache.set(key, made)
  while (cache.size > 64) cache.delete(cache.keys().next().value as string)
  return made
}

/** The (item, cell) a trial index names. */
export function locate(selection: Selection, trialIndex: number): { entry: PoolEntry; cell: number } {
  const entry = selection.entries[Math.floor(trialIndex / selection.cells)]
  if (!Number.isInteger(trialIndex) || trialIndex < 0 || entry === undefined) {
    throw configError('The trial index is outside the planned trials')
  }
  return { entry, cell: trialIndex % selection.cells }
}


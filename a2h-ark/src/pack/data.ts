// How the pack reads its two datasets, and how it chooses which items a test measures.
//
// Corpus item (kind a2h-corpus): key = the source id ({domain}__{topicNumber}__{words}); dimensions
// { domain, topic, words }; content.text always, and (exported corpora only) topicId, title, wordCount, ... The pack
// reads `key`, `dimensions` and `content.text` and falls back gracefully on everything else.
//
// Fixture item (kind a2h-fixtures): key = {corpusKey}__{type}__{ordinal}; dimensions { type, domain, topic, words,
// ordinal }; content { fixtureId, sourceId (= corpus key), type, ordinal, expected, cleanText?, corruptedText?, ... }.
import { parseDatasetInputId } from '@benchmarkr/core'
import { sampleIndices, type DatasetAccess, type DatasetItemView } from '@benchmarkr/contracts'
import { DOMAINS, type Domain } from '../vendor/style/types'
import type { A2HFixtureType, BenchmarkFixture } from '../shared/types'
import { wordCount } from '../scoring/trialCommon'
import { configError, finite, isRecord, str } from './util'

export const CORPUS_INPUT = parseDatasetInputId('corpus')
export const FIXTURES_INPUT = parseDatasetInputId('fixtures')

const PAGE = 1000

export interface CorpusDoc {
  /** The source id: the item key. */
  readonly sourceId: string
  readonly itemHash: string
  readonly domain: Domain
  readonly topicId: string
  readonly targetWords: number
  readonly text: string
  /** Measured from the text when the item does not carry its own count (a generated, not exported, corpus). */
  readonly actualWords: number
}

export function corpusDocOf(item: DatasetItemView): CorpusDoc {
  const text = str(item.content['text'])
  if (text === undefined || text.trim() === '') throw configError('A corpus item has no text', { itemKey: item.key })
  const domainRaw = item.dimensions['domain'] ?? item.content['domain']
  if (typeof domainRaw !== 'string' || !(DOMAINS as readonly string[]).includes(domainRaw)) {
    throw configError('A corpus item has no known domain', { itemKey: item.key })
  }
  const dimWords = item.dimensions['words']
  const targetWords = (typeof dimWords === 'number' ? dimWords : undefined) ?? finite(item.content['targetWords']) ?? wordCount(text)
  const topicNumber = item.dimensions['topic']
  const topicId = str(item.content['topicId']) ?? `${domainRaw}__${String(topicNumber ?? item.key)}`
  return {
    sourceId: str(item.content['sourceId']) ?? item.key,
    itemHash: item.hash,
    domain: domainRaw as Domain,
    topicId,
    targetWords,
    text,
    actualWords: finite(item.content['wordCount']) ?? wordCount(text),
  }
}

export interface FixtureDoc extends BenchmarkFixture {
  /** The fixture dataset item key. */
  readonly key: string
  /** From the item's dimensions, when present (used to stratify and to find the source's domain). */
  readonly domain: string | null
  readonly words: number | null
  /** Repair fixtures only (also lifted into `expected`). */
  readonly cleanText: string | null
  readonly corruptedText: string | null
}

const FIXTURE_TYPES: readonly A2HFixtureType[] = ['citation', 'numeric_unit', 'modality', 'protected_term', 'terminology', 'grammar_repair', 'factual_repair', 'claim_relationship']

export function fixtureDocOf(item: DatasetItemView): FixtureDoc {
  const type = item.content['type'] ?? item.dimensions['type']
  if (typeof type !== 'string' || !(FIXTURE_TYPES as readonly string[]).includes(type)) {
    throw configError('A fixture has an unknown type', { itemKey: item.key })
  }
  const expected = item.content['expected']
  if (!isRecord(expected)) throw configError('A fixture has no expected answer', { itemKey: item.key })
  const cleanText = str(item.content['cleanText']) ?? str(expected['cleanText']) ?? null
  const corruptedText = str(item.content['corruptedText']) ?? str(expected['corruptedText']) ?? null
  const ordinalDim = item.dimensions['ordinal']
  return {
    key: item.key,
    domain: str(item.dimensions['domain']) ?? null,
    words: typeof item.dimensions['words'] === 'number' ? item.dimensions['words'] : null,
    id: str(item.content['fixtureId']) ?? item.key,
    fixtureSetId: '',
    corpusProjectId: '',
    sourceId: str(item.content['sourceId']) ?? '',
    type: type as A2HFixtureType,
    ordinal: finite(item.content['ordinal']) ?? (typeof ordinalDim === 'number' ? ordinalDim : 0),
    // Repair fixtures keep their texts in `expected` too; if only the item carries them, merge them in.
    expected: { ...(cleanText === null ? {} : { cleanText }), ...(corruptedText === null ? {} : { corruptedText }), ...expected },
    sourceStart: finite(item.content['sourceStart']) ?? null,
    sourceEnd: finite(item.content['sourceEnd']) ?? null,
    sourceText: str(item.content['sourceText']) ?? null,
    notes: str(item.content['notes']) ?? null,
    createdAt: '',
    updatedAt: '',
    corruptionGeneratorVersion: str(item.content['corruptionGeneratorVersion']) ?? null,
    cleanText,
    corruptedText,
  }
}

async function readAll(datasets: DatasetAccess, input: typeof CORPUS_INPUT, each: (item: DatasetItemView) => void): Promise<void> {
  let after: string | undefined
  for (;;) {
    const page = await datasets.list(input, { limit: PAGE, ...(after === undefined ? {} : { after }) })
    for (const item of page) each(item)
    if (page.length < PAGE) return
    after = page[page.length - 1]?.key
  }
}

/** One corpus item as the planner sees it: enough to stratify, not the text. */
export interface PoolEntry {
  readonly key: string
  /** Position in the dataset (key order). */
  readonly index: number
  readonly domain: string
  readonly words: number
}

export interface CorpusIndex {
  readonly entries: readonly PoolEntry[]
  readonly byKey: ReadonlyMap<string, PoolEntry>
}

export interface FixtureIndex {
  /** Every fixture in key order. */
  readonly all: readonly FixtureDoc[]
  readonly byKey: ReadonlyMap<string, FixtureDoc>
  readonly bySourceAndType: ReadonlyMap<string, readonly FixtureDoc[]>
  readonly byType: ReadonlyMap<A2HFixtureType, readonly FixtureDoc[]>
}

/** A tiny bounded cache of promises keyed by dataset fingerprint (a published version never changes). */
function boundedCache<T>(max: number): (key: string, make: () => Promise<T>) => Promise<T> {
  const cache = new Map<string, Promise<T>>()
  return (key, make) => {
    const hit = cache.get(key)
    if (hit !== undefined) return hit
    const created = make()
    created.catch(() => cache.delete(key))
    cache.set(key, created)
    while (cache.size > max) cache.delete(cache.keys().next().value as string)
    return created
  }
}

const corpusCache = boundedCache<CorpusIndex>(8)
const fixtureCache = boundedCache<FixtureIndex>(8)

export function corpusIndex(datasets: DatasetAccess): Promise<CorpusIndex> {
  if (!datasets.has(CORPUS_INPUT)) return Promise.reject(configError('The corpus dataset is not bound'))
  return corpusCache(datasets.fingerprint(CORPUS_INPUT), async () => {
    const entries: PoolEntry[] = []
    await readAll(datasets, CORPUS_INPUT, (item) => {
      const doc = corpusDocOf(item)
      entries.push({ key: item.key, index: entries.length, domain: doc.domain, words: doc.targetWords })
    })
    return { entries, byKey: new Map(entries.map((e) => [e.key, e])) }
  })
}

export function fixtureIndex(datasets: DatasetAccess): Promise<FixtureIndex> {
  if (!datasets.has(FIXTURES_INPUT)) return Promise.reject(configError('The fixtures dataset is not bound'))
  return fixtureCache(datasets.fingerprint(FIXTURES_INPUT), async () => {
    const all: FixtureDoc[] = []
    await readAll(datasets, FIXTURES_INPUT, (item) => all.push(fixtureDocOf(item)))
    const bySourceAndType = new Map<string, FixtureDoc[]>()
    const byType = new Map<A2HFixtureType, FixtureDoc[]>()
    for (const fixture of all) {
      const k = `${fixture.sourceId}\u0000${fixture.type}`
      bySourceAndType.set(k, [...(bySourceAndType.get(k) ?? []), fixture])
      byType.set(fixture.type, [...(byType.get(fixture.type) ?? []), fixture])
    }
    for (const list of bySourceAndType.values()) list.sort((a, b) => a.ordinal - b.ordinal || a.key.localeCompare(b.key))
    return { all, byKey: new Map(all.map((f) => [f.key, f])), bySourceAndType, byType }
  })
}

export function fixturesFor(index: FixtureIndex, sourceId: string, type: A2HFixtureType): readonly FixtureDoc[] {
  return index.bySourceAndType.get(`${sourceId}\u0000${type}`) ?? []
}

// ── Selection ────────────────────────────────────────────────────────────

/**
 * Splits `total` over groups of the given sizes as evenly as the sizes allow (no group gets more than it has;
 * what a small group cannot take goes to the others). When fewer items than groups remain, which groups get one
 * is a seeded sample, so the choice is reproducible and not biased towards the first groups.
 */
export function allocate(total: number, sizes: readonly number[], seed: string): number[] {
  const quotas = sizes.map(() => 0)
  let remaining = Math.min(total, sizes.reduce((a, b) => a + b, 0))
  for (let round = 0; remaining > 0 && round < 1000; round += 1) {
    const open = sizes.map((size, i) => (quotas[i] ?? 0) < size ? i : -1).filter((i) => i >= 0)
    if (open.length === 0) break
    const base = Math.floor(remaining / open.length)
    if (base > 0) {
      for (const i of open) {
        const give = Math.min(base, (sizes[i] ?? 0) - (quotas[i] ?? 0))
        quotas[i] = (quotas[i] ?? 0) + give
        remaining -= give
      }
    } else {
      for (const pick of sampleIndices(open.length, remaining, `${seed}|round${String(round)}`)) {
        const i = open[pick] as number
        quotas[i] = (quotas[i] ?? 0) + 1
      }
      remaining = 0
    }
  }
  return quotas
}

/**
 * `count` entries of `pool`, stratified: the count is shared over the domains, then each domain's share over its
 * length ladder (its distinct target lengths), then a seeded sample is drawn inside every (domain, length) cell.
 * The result is in dataset order. `count >= pool.length` selects the whole pool.
 */
export function selectEntries(pool: readonly PoolEntry[], count: number, seed: string): PoolEntry[] {
  if (count >= pool.length) return [...pool].sort((a, b) => a.index - b.index)
  const byDomain = new Map<string, PoolEntry[]>()
  for (const entry of pool) byDomain.set(entry.domain, [...(byDomain.get(entry.domain) ?? []), entry])
  const domains = [...byDomain.keys()].sort()
  const domainQuota = allocate(count, domains.map((d) => byDomain.get(d)?.length ?? 0), `${seed}|domains`)
  const chosen: PoolEntry[] = []
  domains.forEach((domain, di) => {
    const entries = byDomain.get(domain) ?? []
    const lengths = [...new Set(entries.map((e) => e.words))].sort((a, b) => a - b)
    const cells = lengths.map((w) => entries.filter((e) => e.words === w))
    const cellQuota = allocate(domainQuota[di] ?? 0, cells.map((c) => c.length), `${seed}|${domain}`)
    cells.forEach((cell, ci) => {
      const quota = cellQuota[ci] ?? 0
      for (const position of sampleIndices(cell.length, quota, `${seed}|${domain}|${String(lengths[ci])}`)) {
        const entry = cell[position]
        if (entry !== undefined) chosen.push(entry)
      }
    })
  })
  return chosen.sort((a, b) => a.index - b.index)
}

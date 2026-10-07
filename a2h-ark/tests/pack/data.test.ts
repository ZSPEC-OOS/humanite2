import { describe, expect, it } from 'vitest'
import { parseDatasetInputId } from '@benchmarkr/core'
import { allocate, corpusDocOf, corpusIndex, fixtureDocOf, fixtureIndex, fixturesFor, selectEntries, type PoolEntry } from '../../src/pack/data'
import { FakeDatasets, corpusItems, fixtureItems, item } from './harness'

const entry = (index: number, domain: string, words: number): PoolEntry => ({ key: `${domain}__${String(index)}__${String(words)}`, index, domain, words })

describe('allocate', () => {
  it('shares a total evenly, gives a small group what it has and redistributes the rest', () => {
    expect(allocate(10, [5, 5], 's')).toEqual([5, 5])
    const split = allocate(7, [10, 2, 10], 's')
    expect(split[1]).toBe(2) // the small group gives all it has
    expect(split.reduce((a, b) => a + b, 0)).toBe(7)
    expect(Math.min(split[0] ?? 0, split[2] ?? 0)).toBeGreaterThanOrEqual(2)
    expect(allocate(100, [3, 4], 's')).toEqual([3, 4])
    expect(allocate(0, [3, 4], 's')).toEqual([0, 0])
  })

  it('chooses which groups get the odd items by a seeded sample, not the first groups', () => {
    const a = allocate(2, [9, 9, 9, 9, 9, 9], 'seed-a')
    expect(a.reduce((x, y) => x + y, 0)).toBe(2)
    expect(allocate(2, [9, 9, 9, 9, 9, 9], 'seed-a')).toEqual(a)
    const seen = new Set<number>()
    for (let i = 0; i < 40; i += 1) allocate(1, [9, 9, 9, 9], `s${String(i)}`).forEach((q, g) => q > 0 && seen.add(g))
    expect(seen.size).toBeGreaterThan(1)
  })
})

describe('selectEntries', () => {
  const pool: PoolEntry[] = []
  let i = 0
  for (const domain of ['academic', 'business', 'general'])
    for (const words of [100, 200, 300]) for (let t = 0; t < 4; t += 1) pool.push(entry(i++, domain, words))

  it('covers every domain and length before it repeats one', () => {
    const picked = selectEntries(pool, 9, 'seed')
    expect(picked).toHaveLength(9)
    expect(new Set(picked.map((p) => p.domain)).size).toBe(3)
    const byDomain = new Map<string, number[]>()
    for (const p of picked) byDomain.set(p.domain, [...(byDomain.get(p.domain) ?? []), p.words])
    for (const lengths of byDomain.values()) expect(new Set(lengths).size).toBe(3)
  })

  it('is reproducible, ordered, duplicate-free and nested in size', () => {
    const a = selectEntries(pool, 14, 'seed')
    expect(selectEntries(pool, 14, 'seed')).toEqual(a)
    expect(a.map((p) => p.index)).toEqual([...a.map((p) => p.index)].sort((x, y) => x - y))
    expect(new Set(a.map((p) => p.index)).size).toBe(14)
    expect(selectEntries(pool, 14, 'other')).not.toEqual(a)
  })

  it('selects the whole pool when the count reaches it', () => {
    expect(selectEntries(pool, 36, 'x')).toHaveLength(36)
    expect(selectEntries(pool, 1000, 'x')).toHaveLength(36)
  })
})

describe('reading the datasets', () => {
  it('reads an exported corpus item and a generated (text-only) one the same way', () => {
    const [exported] = corpusItems('exported')
    const [generated] = corpusItems('generated')
    const a = corpusDocOf(exported!)
    const b = corpusDocOf(generated!)
    expect(a).toMatchObject({ sourceId: 'general__1__100', domain: 'general', targetWords: 100, topicId: 'general-topic-1' })
    expect(b).toMatchObject({ sourceId: 'general__1__100', domain: 'general', targetWords: 100, topicId: 'general__1' })
    expect(b.actualWords).toBe(b.text.trim().split(/\s+/).length)
  })

  it('refuses an item without text or with an unknown domain', () => {
    expect(() => corpusDocOf(item('x__1__100', { domain: 'general', words: 100 }, {}))).toThrow()
    expect(() => corpusDocOf(item('x__1__100', { domain: 'poetry', words: 100 }, { text: 'hi' }))).toThrow()
  })

  it('reads fixtures by source and type, ordered by ordinal, with repair texts lifted into expected', async () => {
    const datasets = new FakeDatasets({ [parseDatasetInputId('corpus')]: corpusItems(), [parseDatasetInputId('fixtures')]: fixtureItems() })
    const index = await fixtureIndex(datasets)
    expect(index.all).toHaveLength(8 * 8)
    expect(fixturesFor(index, 'general__1__100', 'citation')).toHaveLength(1)
    expect(fixturesFor(index, 'nope', 'citation')).toHaveLength(0)
    const grammar = fixturesFor(index, 'general__1__100', 'grammar_repair')[0]!
    expect(grammar.expected['corruptedText']).toBe(grammar.corruptedText)
    const corpus = await corpusIndex(datasets)
    expect(corpus.entries).toHaveLength(8)
    expect(corpus.entries.every((e, n) => e.index === n)).toBe(true)
  })

  it('pages through datasets larger than a page', async () => {
    const many = Array.from({ length: 2500 }, (_, n) => item(`general__${String(n).padStart(5, '0')}__100`, { domain: 'general', topic: n, words: 100 }, { text: `text ${String(n)}` }))
    const datasets = new FakeDatasets({ [parseDatasetInputId('corpus')]: many })
    expect((await corpusIndex(datasets)).entries).toHaveLength(2500)
    expect(datasets.reads.list).toBe(3)
    await corpusIndex(datasets)
    expect(datasets.reads.list).toBe(3) // cached by fingerprint
  })

  it('refuses a fixture of an unknown type or without an expected answer', () => {
    expect(() => fixtureDocOf(item('a__citation__1', { type: 'x' }, { type: 'x', expected: {} }))).toThrow()
    expect(() => fixtureDocOf(item('a__citation__1', { type: 'citation' }, { type: 'citation' }))).toThrow()
  })
})

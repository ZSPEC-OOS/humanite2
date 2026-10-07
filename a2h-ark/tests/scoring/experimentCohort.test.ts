import { describe, it, expect } from 'vitest'
import { stratifiedSample } from '../../src/scoring/experimentCohort'
import type { BenchmarkRunSource } from '../../src/shared/types'

function source(id: string, domainId: BenchmarkRunSource['domainId']): BenchmarkRunSource {
  return { id: `${id}__row`, runId: 'run-1', corpusProjectId: 'proj-1', sourceId: id, domainId, topicId: 't', targetWords: 100, sourceSha256: 'x' }
}

describe('stratifiedSample — deterministic, reproducible sampling (§40)', () => {
  const sources = [
    ...Array.from({ length: 10 }, (_, i) => source(`gen-${i}`, 'general')),
    ...Array.from({ length: 10 }, (_, i) => source(`med-${i}`, 'medical')),
  ]

  it('returns every source when sampleSize is null', () => {
    const sample = stratifiedSample(sources, null, 'seed-1')
    expect(sample).toHaveLength(20)
  })

  it('returns every source when sampleSize >= total', () => {
    const sample = stratifiedSample(sources, 50, 'seed-1')
    expect(sample).toHaveLength(20)
  })

  it('is deterministic — the same seed always produces the same sample', () => {
    const a = stratifiedSample(sources, 8, 'seed-1')
    const b = stratifiedSample(sources, 8, 'seed-1')
    expect(a).toEqual(b)
  })

  it('a different seed can produce a different sample', () => {
    const a = stratifiedSample(sources, 8, 'seed-1')
    const b = stratifiedSample(sources, 8, 'seed-2')
    // Not a hard guarantee for every possible seed pair, but true for this
    // fixture set — if this ever flakes, the two seeds happened to collide.
    expect(a).not.toEqual(b)
  })

  it('samples exactly sampleSize sources', () => {
    const sample = stratifiedSample(sources, 8, 'seed-1')
    expect(sample).toHaveLength(8)
  })

  it('draws from every domain present, not just one', () => {
    const sample = stratifiedSample(sources, 8, 'seed-1')
    const domains = new Set(sample.map(id => (id.startsWith('gen-') ? 'general' : 'medical')))
    expect(domains.size).toBe(2)
  })

  it('never selects more sources from a domain than that domain has', () => {
    const skewed = [...Array.from({ length: 2 }, (_, i) => source(`rare-${i}`, 'legal')), ...Array.from({ length: 18 }, (_, i) => source(`common-${i}`, 'general'))]
    const sample = stratifiedSample(skewed, 15, 'seed-1')
    const rareCount = sample.filter(id => id.startsWith('rare-')).length
    expect(rareCount).toBeLessThanOrEqual(2)
  })

  it('never returns duplicate source ids', () => {
    const sample = stratifiedSample(sources, 12, 'seed-1')
    expect(new Set(sample).size).toBe(sample.length)
  })
})

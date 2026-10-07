import { describe, expect, it } from 'vitest'
import {
  parseGeneratorSpec, computeSpecChecksum, resolveConfig, expandCells, countCells, listParents, entitiesAxisOf,
  buildItemRequest, createBuiltinCheckRegistry, runChecks, type GeneratorEntity, type GeneratorSpec,
} from '@benchmarkr/generator'
import { corpusSpec, specs, parseSpecs, getSpec, CORPUS_SPEC_ID } from '../../src/generator-specs'
import { DOMAINS } from '../../src/vendor/style/types'
import { DEFAULT_LENGTH_LADDER, TOPICS_PER_DOMAIN, MAX_TOPICS_PER_DOMAIN } from '../../src/shared/types'
import { isWithinTolerance, toleranceFor } from '../../src/scoring/corpus'

function parsed(): GeneratorSpec {
  const r = parseGeneratorSpec(corpusSpec)
  if (!r.valid) throw new Error(JSON.stringify(r.issues))
  return r.value
}

function curate(spec: GeneratorSpec, perDomain: number): GeneratorEntity[] {
  const axis = entitiesAxisOf(spec)!
  return listParents(spec, resolveConfig(spec, {})).flatMap(parent =>
    Array.from({ length: perDomain }, (_, i) => ({
      axisId: axis.id, parentKey: parent.key, number: i + 1, enabled: true,
      fields: {
        title: `${parent.key} topic ${i + 1}`, writingType: 'Overview', description: 'Scope sentence.',
        intendedAudience: 'General readers', coreConcepts: ['causes', 'effects', 'history', 'outlook'],
      },
    })))
}

describe('a2h-corpus generator spec', () => {
  it('is valid under BenchMarkr parseGeneratorSpec and has a stable checksum', () => {
    const spec = parsed()
    expect(spec.id).toBe(CORPUS_SPEC_ID)
    expect(computeSpecChecksum(spec)).toBe(computeSpecChecksum(parsed()))
    expect(specs).toHaveLength(1)
    expect(getSpec('a2h-corpus')).toBe(corpusSpec)
    expect(parseSpecs(parseGeneratorSpec)).toHaveLength(1)
  })

  it('matches the ark corpus constants (domains, ladder, counts)', () => {
    const spec = parsed()
    const domain = spec.axes.find(a => a.id === 'domain')
    const words = spec.axes.find(a => a.id === 'words')
    expect(domain && 'values' in domain ? domain.values : null).toEqual([...DOMAINS])
    expect(words && 'values' in words ? words.values : null).toEqual([...DEFAULT_LENGTH_LADDER])
    const topic = entitiesAxisOf(spec)!
    expect(topic.defaultCount).toBe(TOPICS_PER_DOMAIN)
    expect(topic.maxCount).toBe(MAX_TOPICS_PER_DOMAIN)
    expect(topic.fields.map(f => f.id).sort()).toEqual(['coreConcepts', 'description', 'intendedAudience', 'title', 'writingType'])
  })

  it('expands to 6 domains x N topics x 10 lengths with unique domain__n__words keys', () => {
    const spec = parsed()
    const resolved = resolveConfig(spec, {})
    for (const n of [1, 3, 20]) {
      const entities = curate(spec, n)
      const cells = expandCells(spec, resolved, entities)
      expect(cells).toHaveLength(6 * n * 10)
      expect(countCells(spec, resolved, entities)).toBe(6 * n * 10)
      expect(new Set(cells.map(c => c.key)).size).toBe(cells.length)
    }
    const cells = expandCells(spec, resolved, curate(spec, 2))
    expect(cells[0]!.key).toBe('general__1__100')
    expect(cells[0]!.dimensions).toEqual({ domain: 'general', words: 100, topic: 1 })
    expect(cells.at(-1)!.key).toBe('legal__2__2000')
  })

  it('honors a project length ladder and per-domain topic overrides', () => {
    const spec = parsed()
    const resolved = resolveConfig(spec, { axisValues: { words: [100, 500] }, entityCounts: { default: 2, overrides: { medical: 3 } } })
    const axis = entitiesAxisOf(spec)!
    const entities: GeneratorEntity[] = listParents(spec, resolved).flatMap(p =>
      Array.from({ length: p.key === 'medical' ? 3 : 2 }, (_, i) => ({
        axisId: axis.id, parentKey: p.key, number: i + 1, enabled: true,
        fields: { title: `${p.key}${i}`, writingType: 'w', description: 'd', intendedAudience: 'a', coreConcepts: ['x'] },
      })))
    expect(expandCells(spec, resolved, entities)).toHaveLength((5 * 2 + 3) * 2)
    expect(() => resolveConfig(spec, { entityCounts: { default: 51 } })).toThrow()
  })

  it('renders the source-text prompt with Humanite wording and the token ceiling', () => {
    const spec = parsed()
    const cell = expandCells(spec, resolveConfig(spec, {}), curate(spec, 1)).find(c => c.key === 'medical__1__750')!
    const req = buildItemRequest(spec, cell)
    expect(req.prompt.split('\n')[0]).toBe('Write a natural, standalone Overview of approximately 750 words on the following topic.')
    expect(req.prompt).toContain('Core concepts to cover: causes, effects, history, outlook')
    expect(req.prompt).toContain('do not write a longer piece and cut it short')
    expect(req.json).toBe(false)
    expect(req.temperature).toBeUndefined()
    expect(req.maxTokens).toBe(Math.min(4096, Math.ceil(750 * 2.2) + 200))
    const big = buildItemRequest(spec, expandCells(spec, resolveConfig(spec, {}), curate(spec, 1)).find(c => c.key === 'legal__1__2000')!)
    expect(big.maxTokens).toBe(4096)
  })

  it('built-in word-count bands agree with Humanite toleranceFor/isWithinTolerance for every ladder length', () => {
    const spec = parsed()
    const registry = createBuiltinCheckRegistry()
    for (const target of DEFAULT_LENGTH_LADDER) {
      const tol = toleranceFor(target)
      // sweep from -10% to +10% of the target, including the exact boundaries
      const candidates = new Set<number>([Math.floor(target * (1 - tol)), Math.ceil(target * (1 - tol)), Math.floor(target * (1 + tol)), Math.ceil(target * (1 + tol))])
      for (let w = Math.floor(target * 0.9); w <= Math.ceil(target * 1.1); w++) candidates.add(w)
      for (const words of candidates) {
        const text = Array.from({ length: words }, () => 'w').join(' ')
        const results = runChecks(registry, spec.item.checks, { text }, { values: { domain: 'general', words: target } })
        const wc = results.find(r => r.type === 'word-count')!
        expect(wc.passed, `target ${target} words ${words}`).toBe(isWithinTolerance(target, words))
      }
    }
    // boundary band edges: 300 uses 5%, 1000 uses 4%, 1250 uses 3%
    const tolOf = (target: number) => runChecks(registry, spec.item.checks, { text: 'w' }, { values: { words: target } }).find(r => r.type === 'word-count')!.measured!['tolerance']
    expect([tolOf(300), tolOf(500), tolOf(1000), tolOf(1250)]).toEqual([0.05, 0.04, 0.04, 0.03])
  })

  it('rejects an empty answer', () => {
    const spec = parsed()
    const results = runChecks(createBuiltinCheckRegistry(), spec.item.checks, { text: '  ' }, { values: { words: 100 } })
    expect(results.find(r => r.type === 'non-empty')!.passed).toBe(false)
  })
})

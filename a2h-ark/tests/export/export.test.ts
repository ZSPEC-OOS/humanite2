import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { parseItems, normalizeItem, serializeItems } from '@benchmarkr/datasets'
import { parseGeneratorSpec, resolveConfig, expandCells, listParents, entitiesAxisOf, type GeneratorEntity } from '@benchmarkr/generator'
import { buildExport, serializeExport, toJsonl, corpusItemKey } from '../../tools/export/export'
import { run, docSourceFromDump } from '../../tools/export/cli'
import { corpusSpec } from '../../src/generator-specs'
import { A2H_COLLECTIONS } from '../../src/shared/types'
import { makeDump, memorySource, PROJECT_ID } from './fakeData'

describe('export tool', () => {
  it('exports every frozen source, deterministic and sorted, with a counts summary', async () => {
    const result = await buildExport(memorySource(makeDump()))
    expect(result.errors).toEqual([])
    expect(result.ok).toBe(true)
    expect(result.corpus).toHaveLength(6 * 3 * 3)
    expect(result.summary).toMatchObject({ corpusItems: 54, outOfTolerance: 0, fixtures: 4, fixtureSetId: 'fs2', fixtureVersion: 'FIXTURE-V002', lengths: [100, 200, 500] })
    expect(result.summary!.corpusPerDomain).toEqual({ academic: 9, business: 9, general: 9, legal: 9, medical: 9, technical: 9 })
    const keys = result.corpus.map(i => i.key)
    expect(keys).toEqual([...keys].sort())
    const again = await buildExport(memorySource(makeDump()))
    expect(serializeExport(again)).toEqual(serializeExport(result))
  })

  it('writes the documented corpus item shape', async () => {
    const { corpus } = await buildExport(memorySource(makeDump()))
    const item = corpus.find(i => i.key === 'legal__2__200')!
    expect(item.dimensions).toEqual({ domain: 'legal', topic: 2, words: 200 })
    expect(Object.keys(item.content).sort()).toEqual(['coreConcepts', 'description', 'domain', 'humaniteSourceId', 'intendedAudience', 'sourceId', 'targetWords', 'text', 'title', 'topicId', 'topicNumber', 'wordCount', 'writingType'])
    expect(item.content).toMatchObject({ sourceId: 'legal__2__200', humaniteSourceId: `${PROJECT_ID}__tp_legal_2__200`, domain: 'legal', topicId: 'tp_legal_2', title: 'legal topic 2', targetWords: 200, wordCount: 200 })
  })

  it('reports out-of-tolerance word counts without failing', async () => {
    const id = `${PROJECT_ID}__tp_general_1__100`
    const r = await buildExport(memorySource(makeDump({ skewWords: { [id]: 120 } })))
    expect(r.ok).toBe(true)
    expect(r.summary!.outOfTolerance).toBe(1)
    expect(r.warnings.some(w => w.includes(id) && w.includes('outside'))).toBe(true)
  })

  it('applies the fixture validators to every fixture', async () => {
    const dump = makeDump()
    ;(dump[A2H_COLLECTIONS.fixtures]!.find(f => f['id'] === 'fx_general_0_v2')!['expected'] as Record<string, unknown>)['incorrectText'] = 'not in the text'
    const r = await buildExport(memorySource(dump))
    expect(r.ok).toBe(false)
    expect(r.errors.join('\n')).toMatch(/fx_general_0_v2.*invalid expected/)
    expect(() => serializeExport(r)).toThrow()
  })

  it('rejects duplicate keys and dangling sources', async () => {
    const dump = makeDump()
    dump[A2H_COLLECTIONS.fixtures]!.push({ ...dump[A2H_COLLECTIONS.fixtures]!.find(f => f['id'] === 'fx_general_0_v2')!, id: 'dup' })
    const dup = await buildExport(memorySource(dump))
    expect(dup.errors.some(e => e.startsWith('Duplicate fixture key'))).toBe(true)

    const dump2 = makeDump()
    dump2[A2H_COLLECTIONS.topics]!.find(t => t['id'] === 'tp_legal_2')!['topicNumber'] = 1 // collides with legal topic 1
    const dup2 = await buildExport(memorySource(dump2))
    expect(dup2.errors.some(e => e.startsWith('Duplicate corpus key "legal__1__'))).toBe(true)

    const dump3 = makeDump()
    dump3[A2H_COLLECTIONS.fixtures]![0]!['sourceId'] = 'nope'
    expect((await buildExport(memorySource(dump3))).errors.some(e => e.includes('not an exported'))).toBe(true)
  })

  it('selects the project and fixture set explicitly and fails clearly when ambiguous', async () => {
    const dump = makeDump()
    dump[A2H_COLLECTIONS.projects]!.push({ ...dump[A2H_COLLECTIONS.projects]![0]!, id: 'proj2' })
    expect((await buildExport(memorySource(dump))).errors[0]).toMatch(/Several frozen/)
    const r = await buildExport(memorySource(dump), { corpusProjectId: PROJECT_ID, fixtureSetId: 'fs1' })
    expect(r.summary).toMatchObject({ fixtureSetId: 'fs1', fixtures: 1 })
    expect((await buildExport(memorySource(dump), { corpusProjectId: 'zzz' })).ok).toBe(false)
  })

  it('round trip: export -> BenchMarkr JSONL decode -> items validate and match the generator grid keys', async () => {
    const result = await buildExport(memorySource(makeDump()))
    const files = serializeExport(result)
    const corpusItems = parseItems('jsonl', files['corpus.jsonl'])
    const fixtureItems = parseItems('jsonl', files['fixtures.jsonl'])
    expect(corpusItems).toHaveLength(54)
    expect(fixtureItems).toHaveLength(4)
    // BenchMarkr's own serializer re-encodes to an equivalent, hashed form
    expect(parseItems('jsonl', serializeItems('jsonl', corpusItems))).toEqual(corpusItems)
    for (const i of corpusItems) normalizeItem({ key: i.key, dimensions: i.dimensions, content: i.content, provenance: i.provenance, hash: i.hash })
    const fx = fixtureItems.find(i => i.key === 'general__1__100__grammar_repair__0')!
    expect(fx.content).toMatchObject({ fixtureId: 'fx_general_0_v2', sourceId: 'general__1__100', type: 'grammar_repair', cleanText: 'Sentence 0 where the system works.', corruptedText: 'Sentence 0 where the system work.' })
    expect(corpusItems.some(c => c.key === fx.content['sourceId'])).toBe(true)

    // exported keys/dimensions are exactly what the a2h-corpus generator would produce for the same grid
    const spec = (() => { const r = parseGeneratorSpec(corpusSpec); if (!r.valid) throw new Error('spec'); return r.value })()
    const axis = entitiesAxisOf(spec)!
    const resolved = resolveConfig(spec, { axisValues: { words: [100, 200, 500] }, entityCounts: { default: 3, overrides: {} } })
    const entities: GeneratorEntity[] = listParents(spec, resolved).flatMap(p => [1, 2, 3].map(n => ({
      axisId: axis.id, parentKey: p.key, number: n, enabled: true,
      fields: { title: `${p.key} topic ${n}`, writingType: 'Overview', description: 'Scope.', intendedAudience: 'General readers', coreConcepts: ['a', 'b'] },
    })))
    const cells = expandCells(spec, resolved, entities)
    expect(cells.map(c => c.key).sort()).toEqual(corpusItems.map(i => i.key).sort())
    const byKey = new Map(corpusItems.map(i => [i.key, i]))
    for (const c of cells) expect(byKey.get(c.key)!.dimensions).toEqual(c.dimensions)
    expect(corpusItemKey('legal', 2, 200)).toBe('legal__2__200')
  })

  it('CLI: dump file -> files, manifest has counts and sha256 of each output', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'a2h-export-'))
    const dumpPath = path.join(dir, 'dump.json')
    writeFileSync(dumpPath, JSON.stringify(makeDump()))
    const out = path.join(dir, 'out')
    const logs: string[] = []
    expect(await run(['--dump', dumpPath, '--out', out], s => logs.push(s))).toBe(0)
    const manifest = JSON.parse(readFileSync(path.join(out, 'manifest.json'), 'utf8'))
    expect(manifest.counts).toMatchObject({ corpusItems: 54, fixtures: 4, outOfTolerance: 0 })
    for (const name of ['corpus.jsonl', 'fixtures.jsonl']) {
      const body = readFileSync(path.join(out, name))
      expect(manifest.files[name].sha256).toBe(createHash('sha256').update(body).digest('hex'))
      expect(manifest.files[name].bytes).toBe(body.length)
    }
    expect(manifest.files['corpus.jsonl'].lines).toBe(54)

    // array-of-records dump format gives the same files
    const records = Object.entries(makeDump()).flatMap(([collection, docs]) => docs.map(data => ({ collection, id: data['id'], data })))
    const dump2 = path.join(dir, 'dump.jsonl')
    writeFileSync(dump2, records.map(r => JSON.stringify(r)).join('\n'))
    const out2 = path.join(dir, 'out2')
    expect(await run(['--dump', dump2, '--out', out2], () => {})).toBe(0)
    expect(readFileSync(path.join(out2, 'corpus.jsonl'), 'utf8')).toBe(readFileSync(path.join(out, 'corpus.jsonl'), 'utf8'))

    // failure writes nothing
    const bad = makeDump(); bad[A2H_COLLECTIONS.fixtures]![0]!['type'] = 'bogus'
    writeFileSync(dumpPath, JSON.stringify(bad))
    const out3 = path.join(dir, 'out3')
    expect(await run(['--dump', dumpPath, '--out', out3], () => {})).toBe(1)
    expect(existsSync(out3)).toBe(false)
    expect(toJsonl([])).toBe('')
    expect(await docSourceFromDump({ a: [{ x: 1 }, { x: 2 }] }).listDocs('a', { x: 2 })).toEqual([{ x: 2 }])
  })
})

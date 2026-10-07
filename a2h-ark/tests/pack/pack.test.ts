import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, symlinkSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { validatePack, type BenchmarkrPack } from '@benchmarkr/contracts'
import createPack, { createA2hPack } from '../../src/pack/index'
import { CORPUS_DATASET_KIND, FIXTURES_DATASET_KIND, specs } from '../../src/generator-specs/index'
import { CORPUS_KIND, FIXTURES_KIND } from '../../src/pack/util'

const benchmarkr = process.env['BENCHMARKR_PATH'] ?? resolve(__dirname, '../../../../benchmarkr')
const root = resolve(__dirname, '../..')

describe('the pack entry', () => {
  it('default-exports a valid pack with the adapter, the benchmark package and the corpus generator spec', () => {
    const pack = (createPack as () => BenchmarkrPack)()
    expect(validatePack(pack)).toEqual([])
    expect(pack).toMatchObject({ packId: 'com.humanite.a2h', version: '1.0.0' })
    expect(pack.targetAdapters?.map((a) => a.manifest().adapterId)).toEqual(['com.humanite.a2h-target'])
    expect(pack.benchmarkPackages?.map((p) => p.manifest().packageId)).toEqual(['com.humanite.a2h'])
    expect(pack.generatorSpecs).toEqual(specs)
    expect(pack.generatorSpecs?.length).toBeGreaterThan(0)
  })

  it('builds a fresh, identical pack each time (the loader may call the export more than once)', () => {
    const a = createA2hPack()
    const b = createA2hPack()
    expect(a).not.toBe(b)
    expect(JSON.stringify(a.benchmarkPackages?.[0]?.manifest())).toBe(JSON.stringify(b.benchmarkPackages?.[0]?.manifest()))
  })

  it('agrees with the generator spec and export tool on the dataset kinds', () => {
    expect(CORPUS_KIND).toBe(CORPUS_DATASET_KIND)
    expect(FIXTURES_KIND).toBe(FIXTURES_DATASET_KIND)
  })
})

describe('the built pack (dist/pack.mjs)', () => {
  const out = join(mkdtempSync(join(tmpdir(), 'a2h-pack-')), 'pack.mjs')
  execFileSync(process.execPath, [join(root, 'scripts/build-pack.mjs')], { env: { ...process.env, A2H_PACK_OUT: out }, stdio: 'pipe' })
  const source = readFileSync(out, 'utf8')

  it('is one file whose only run-time imports are the two BenchMarkr packages and Node built-ins', () => {
    const imports = [...source.matchAll(/(?:^|\n)\s*import\s[^;]*?from\s+["']([^"']+)["']/g)].map((m) => m[1] as string)
    const external = [...new Set(imports)].filter((i) => !i.startsWith('node:') && i !== 'crypto')
    expect(external.sort()).toEqual(['@benchmarkr/contracts', '@benchmarkr/core'])
    expect(source).not.toMatch(/humanite2\/src|from ["']@\//)
    expect(source).toContain('com.humanite.a2h')
  })

  const loadable = existsSync(join(benchmarkr, 'packages/contracts/dist/index.js')) && existsSync(join(benchmarkr, 'node_modules/@benchmarkr/core'))
  it.skipIf(!loadable)('loads where @benchmarkr/* resolve (BenchMarkr checkout with dependencies built) and is a valid pack', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'a2h-load-'))
    symlinkSync(join(benchmarkr, 'node_modules'), join(dir, 'node_modules'))
    copyFileSync(out, join(dir, 'pack.mjs'))
    const mod = (await import(pathToFileURL(join(dir, 'pack.mjs')).href)) as { default: () => BenchmarkrPack }
    const pack = mod.default()
    expect(validatePack(pack)).toEqual([])
    expect(pack.benchmarkPackages?.[0]?.catalog().tests).toHaveLength(17)
  })
})

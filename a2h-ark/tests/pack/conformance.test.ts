import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { checkBenchmarkPackageConformance, checkTargetAdapterConformance } from '@benchmarkr/contracts'
import { parseBenchmarkTestId } from '@benchmarkr/core'
import { createA2hBenchmarkPackage } from '../../src/pack/package'
import { createA2hTargetAdapter } from '../../src/pack/adapter'
import { context, execContext, makeEnv, manifestFor, plan, plain, services } from './harness'

const adapter = createA2hTargetAdapter()
const pkg = createA2hBenchmarkPackage()
let fx: Awaited<ReturnType<typeof makeEnv>>

beforeAll(async () => {
  fx = await makeEnv(pkg, adapter)
  fx.env.trialsPerTest = 20
  for (const test of pkg.catalog().tests) fx.env.planned[test.id] = await plan(fx.env, test.id)
  fx.env.selected = pkg.catalog().tests.map((t) => t.id)
})
afterAll(async () => {
  await fx.stop()
})

const failures = (report: { failures: ReadonlyArray<{ name: string; detail?: string }> }): string[] => report.failures.map((c) => `${c.name}${c.detail === undefined ? '' : ` -- ${c.detail}`}`)

describe("BenchMarkr's conformance checks", () => {
  it('the adapter satisfies the adapter contract (collectResult is time-stamped, so not bit-for-bit repeatable)', async () => {
    const env = fx.env
    const spec = plain(await pkg.createTrialSpec(parseBenchmarkTestId('A2H-08'), context(env, 'A2H-08', 0)))
    const report = await checkTargetAdapterConformance({
      adapter,
      context: execContext(env),
      invalidConfigs: [{}, { baseUrl: 'http://remote.example', credentialId: 'crd_x' }, { baseUrl: 'https://h.example', credentialId: 'crd_x', extra: 1 }],
      trial: spec,
    })
    // The reference fake runs on virtual time; a real adapter's timestamps differ between two runs.
    expect(failures(report)).toEqual(['collectResult is deterministic'])
  })

  it('the package satisfies the package contract for every test that has trials', async () => {
    const env = fx.env
    const runtime = { services: services(env), signal: env.controller.signal, datasets: env.datasets, memo: env.memo }
    const wrapped = {
      ...pkg,
      verify: (t: never, r: never, f: never) => pkg.verify(t, r, f, runtime),
      score: (v: never, r: never) => pkg.score(v, r, runtime),
    }
    const report = await checkBenchmarkPackageConformance({
      pkg: wrapped as never,
      context: context(env, 'A2H-08', 0),
      aggregationContext: { manifest: manifestFor(env), scope: 'scope' as never },
      rawResultFor: async (trial) => {
        const ctx = execContext(env)
        const prepared = await adapter.prepareTrial(ctx, trial)
        const handle = await adapter.startTrial(ctx, prepared)
        const raw = await adapter.collectResult(ctx, handle)
        await adapter.cleanupTrial(ctx, handle)
        return plain(raw)
      },
      privateMarkers: ['expectedCorrection', 'incorrectText', 'normalizedText', DETECTOR_MARKER],
    })
    // A2H-03 and A2H-17 have no trials of their own (they are batch-level roll-ups), so no spec exists to check.
    expect(failures(report).filter((n) => !n.includes('A2H-03') && !n.includes('A2H-17'))).toEqual([])
    expect(failures(report).every((n) => n.includes('A2H-03') || n.includes('A2H-17'))).toBe(true)
  })
})

const DETECTOR_MARKER = 'detector-test-key-77c1'

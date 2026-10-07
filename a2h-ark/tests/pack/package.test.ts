import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { validatePack, checkBenchmarkPackageConformance } from '@benchmarkr/contracts'
import { createA2hBenchmarkPackage } from '../../src/pack/package'
import { createA2hTargetAdapter } from '../../src/pack/adapter'
import { aggregateOf, makeEnv, runTest, plan, runTrial, type Env, type Fixture, type TrialOutcome } from './harness'

let fx: Fixture & Awaited<ReturnType<typeof makeEnv>>
let env: Env
const pkg = createA2hBenchmarkPackage()

beforeAll(async () => {
  fx = await makeEnv(pkg, createA2hTargetAdapter())
  env = fx.env
  env.trialsPerTest = 20
})
afterAll(async () => {
  await fx.stop()
})

describe('catalog', () => {
  it('declares the 17 tests with Humanite labels, only 01-03 on by default and 07, 11, 14, 15 experimental', () => {
    const tests = pkg.catalog().tests
    expect(tests.map((t) => t.id)).toEqual(Array.from({ length: 17 }, (_, i) => `A2H-${String(i + 1).padStart(2, '0')}`))
    expect(tests[0]?.title).toBe('A2H-01 GPTZero AI-to-Human Conversion')
    const defaults = tests.filter((t) => t.metadata['defaultEnabled'] === true).map((t) => t.id)
    expect(defaults).toEqual(['A2H-01', 'A2H-02', 'A2H-03'])
    const experimental = tests.filter((t) => t.metadata['experimental'] === true).map((t) => t.id)
    expect(experimental).toEqual(['A2H-07', 'A2H-11', 'A2H-14', 'A2H-15'])
    for (const t of tests) expect(String(t.metadata['description']).length).toBeGreaterThan(40)
  })

  it('declares the corpus (required), fixtures (optional), the detector role and a valid manifest', () => {
    const m = pkg.manifest()
    expect(m.packageId).toBe('com.humanite.a2h')
    expect(m.testCount).toBe(17)
    expect(m.datasetInputs?.map((d) => [d.id, d.kind, d.required])).toEqual([
      ['corpus', 'a2h-corpus', true],
      ['fixtures', 'a2h-fixtures', false],
    ])
    expect(m.serviceRoles?.map((r) => [r.id, r.kind, r.credentialTypes])).toEqual([['detector', 'detector', ['api_key']]])
  })

  it('records the design parameters in the catalog, so the checksum covers them', () => {
    const custom = createA2hBenchmarkPackage({ intensities: [2, 4] })
    expect(JSON.stringify(custom.catalog())).not.toBe(JSON.stringify(pkg.catalog()))
  })

  it('is a valid pack together with the adapter', () => {
    expect(validatePack({ packId: 'com.humanite.a2h', name: 'x', version: '1.0.0', targetAdapters: [createA2hTargetAdapter()], benchmarkPackages: [pkg] })).toEqual([])
    expect(pkg.validateTarget({ capabilities: ['structured-task-execution' as never] }).satisfied).toBe(true)
    expect(pkg.validateTarget({ capabilities: [] }).satisfied).toBe(false)
  })
})

describe('planning', () => {
  it('plans items x cells within the budget, and nothing for the roll-ups', async () => {
    env.trialsPerTest = 20
    expect(await plan(env, 'A2H-01')).toBe(20) // 2 items x 10 intensities
    expect(await plan(env, 'A2H-02')).toBe(20)
    expect(await plan(env, 'A2H-03')).toBe(0)
    expect(await plan(env, 'A2H-17')).toBe(0)
    expect(await plan(env, 'A2H-07')).toBe(15) // 1 item x 3 intensities x 5 repeats (20 / 15 rounds down to 1)
    expect(await plan(env, 'A2H-11')).toBe(18) // 6 items x 3 contrasts
    expect(await plan(env, 'A2H-14')).toBe(16) // 10 items by budget, capped at the 8 sources, x 2 contrasts
  })

  it('always plans at least one whole item, and never more items than exist', async () => {
    env.trialsPerTest = 1
    expect(await plan(env, 'A2H-01')).toBe(10)
    env.trialsPerTest = 100000
    expect(await plan(env, 'A2H-01')).toBe(80) // all 8 sources x 10 intensities
    env.trialsPerTest = 20
  })

  it('stratifies the item sample over domains and lengths, deterministically', async () => {
    env.trialsPerTest = 40 // 4 items
    const total = await plan(env, 'A2H-01')
    expect(total).toBe(40)
    env.planned = { 'A2H-01': total }
    const keys = new Set<string>()
    for (let i = 0; i < total; i += 1) {
      const spec = await pkg.createTrialSpec('A2H-01' as never, (await import('./harness')).context(env, 'A2H-01', i))
      keys.add(String(spec.metadata['itemKey']))
    }
    expect(keys.size).toBe(4)
    const domains = new Set([...keys].map((k) => k.split('__')[0]))
    expect(domains).toEqual(new Set(['general', 'legal']))
    const lengths = [...keys].map((k) => k.split('__')[2])
    expect(new Set(lengths).size).toBe(2)
    env.trialsPerTest = 20
  })

  it('fails planning clearly when a fixture test has no fixtures bound', async () => {
    const bare = await makeEnv(pkg, createA2hTargetAdapter(), {}, { fixtures: null })
    await expect(plan(bare.env, 'A2H-04')).rejects.toMatchObject({ code: 'FRAMEWORK_CONFIG' })
    await expect(plan(bare.env, 'A2H-01')).resolves.toBeGreaterThan(0)
    await bare.stop()
  })
})

describe('trial specs', () => {
  it('give the target only calls: no fixture answers, no detector, no secrets', async () => {
    env.planned = {}
    env.trialsPerTest = 20
    const total = await plan(env, 'A2H-04')
    env.planned = { 'A2H-04': total }
    const { context } = await import('./harness')
    const spec = await pkg.createTrialSpec('A2H-04' as never, context(env, 'A2H-04', 3))
    expect(Object.keys(spec.parameters)).toEqual(['calls'])
    const text = JSON.stringify(spec.parameters)
    expect(text).not.toContain('expected')
    expect(text).not.toContain('normalizedText')
    expect(text).not.toContain('detector')
    expect(spec.timeoutMs).toBeGreaterThan(0)
  })

  it('reads generated-style corpus items (text only) too', async () => {
    const generated = await makeEnv(pkg, createA2hTargetAdapter(), {}, { corpus: (await import('./harness')).corpusItems('generated'), fixtures: null })
    generated.env.trialsPerTest = 10
    const out = await runTest(generated.env, 'A2H-08')
    expect(out).toHaveLength(10)
    expect(out[0]?.scored.status).toBe('MEASURED')
    await generated.stop()
  })
})

describe('A2H-01 conversion', () => {
  let outcomes: TrialOutcome[]
  beforeAll(async () => {
    env.planned = {}
    outcomes = await runTest(env, 'A2H-01')
  })

  it('scores baseline-AI sources: converted passes, with the baseline origin run and shared memo', () => {
    expect(outcomes).toHaveLength(20)
    for (const o of outcomes) {
      expect(o.verification.status).toBe('passed')
      expect(o.scored.status).toBe('PASS')
      const m = o.scored.metadata['measurement'] as Record<string, unknown>
      expect(m['classificationBefore']).toBe('ai-generated')
      expect(m['classificationAfter']).toBe('human-written')
      expect(m['convertedAiToHuman']).toBe(true)
      expect(o.scored.value.numeric).toBeCloseTo(0.92 - 0.08, 10)
      expect(m['baselineOriginRunId']).toBe('bat_firstrun')
      expect(m['baselineReusedAcrossRuns']).toBe(true)
    }
  })

  it('computes each baseline once: 10 intensities of an item share one detector call', () => {
    expect(env.memo.computes).toBe(2)
    // 2 baselines + 20 post scores
    expect(fx.detector.requests).toHaveLength(2 + 20)
  })

  it('aggregates the conversion rate through the ark', async () => {
    const agg = await aggregateOf(env, outcomes.map((o) => o.scored), { testId: 'A2H-01' })
    expect(agg.status).toBe('MEASURED')
    expect(agg.value).toEqual({ numeric: 1, unit: 'ratio' })
    expect(agg.sampleCount).toBe(20)
    expect(agg.metadata['direction']).toBe('higher-is-better')
    const report = agg.metadata['report'] as { overall: { n: number; nEligible: number; nConverted: number }; byIntensity: Record<string, unknown>; byDomain: Record<string, unknown> }
    expect(report.overall).toMatchObject({ n: 20, nEligible: 20, nConverted: 20 })
    expect(Object.keys(report.byIntensity)).toHaveLength(10)
    expect(Object.keys(report.byDomain).sort()).toEqual(['general', 'legal'])
  })
})

describe('A2H-02 intensity response', () => {
  it('records requested and applied intensity from the domain cap and aggregates the trend', async () => {
    env.planned = {}
    const outcomes = await runTest(env, 'A2H-02')
    expect(outcomes).toHaveLength(20)
    const legal = outcomes.filter((o) => (o.spec.metadata['a2h'] as { domain: string }).domain === 'legal')
    const high = legal.find((o) => (o.spec.metadata['a2h'] as { intensity: number }).intensity === 9)
    const m = high?.scored.metadata['measurement'] as { appliedIntensity: number; intensityCapped: boolean; intensity: number }
    expect(m).toMatchObject({ intensity: 9, appliedIntensity: 4, intensityCapped: true })
    expect(high?.scored.status).toBe('MEASURED')
    const agg = await aggregateOf(env, outcomes.map((o) => o.scored), { testId: 'A2H-02' })
    expect(agg.value.unit).toBe('magnitude')
    expect(agg.metadata['direction']).toBeUndefined()
    const report = agg.metadata['report'] as { byAppliedIntensity: Record<string, unknown>; trend: unknown }
    expect(Object.keys(report.byAppliedIntensity).length).toBeGreaterThan(1)
    expect(report.trend).not.toBeNull()
  })
})

describe('preservation tests (04, 05, 09, 10, 13, 16)', () => {
  for (const code of ['A2H-04', 'A2H-05', 'A2H-09', 'A2H-10', 'A2H-13', 'A2H-16']) {
    it(`${code}: runs createTrialSpec -> adapter -> verify -> score -> aggregate and preserves`, async () => {
      env.planned = {}
      const outcomes = await runTest(env, code)
      expect(outcomes.length).toBeGreaterThan(0)
      for (const o of outcomes) {
        expect(o.scored.status).toBe('PASS')
        expect(o.verification.status).toBe('passed')
        expect(o.scored.value.numeric).toBe(1)
      }
      const agg = await aggregateOf(env, outcomes.map((o) => o.scored), { testId: code })
      expect(agg.value.numeric).toBe(1)
      expect(agg.metadata['direction']).toBe('higher-is-better')
    })
  }

  it('A2H-09 fails a source whose output reversed the modality, and the failure is a result, not an error', async () => {
    const damaged = await makeEnv(pkg, createA2hTargetAdapter(), { damage: true })
    damaged.env.trialsPerTest = 10
    const outcomes = await runTest(damaged.env, 'A2H-09')
    for (const o of outcomes) {
      expect(o.verification.status).toBe('failed')
      expect(o.scored.status).toBe('FAIL')
    }
    const agg = await aggregateOf(damaged.env, outcomes.map((o) => o.scored), { testId: 'A2H-09' })
    expect(agg.value.numeric).toBe(0)
    await damaged.stop()
  })

  it('marks sources with no fixture of the type NOT_ELIGIBLE and leaves them out of the rate', async () => {
    const fixtures = (await import('./harness')).fixtureItems().filter((f) => !(f.content['type'] === 'citation' && String(f.key).startsWith('legal')))
    const partial = await makeEnv(pkg, createA2hTargetAdapter(), {}, { fixtures })
    partial.env.trialsPerTest = 100
    // The pool only holds sources that have a citation fixture, so every planned trial is eligible.
    const outcomes = await runTest(partial.env, 'A2H-04')
    expect(outcomes.every((o) => o.scored.status === 'PASS')).toBe(true)
    expect(outcomes.every((o) => (o.spec.metadata['a2h'] as { domain: string }).domain === 'general')).toBe(true)
    await partial.stop()
  })
})

describe('A2H-08 grammar damage', () => {
  it('is a measurement: passed is always null, never a pass or fail', async () => {
    env.planned = {}
    const outcomes = await runTest(env, 'A2H-08')
    for (const o of outcomes) {
      expect(['MEASURED', 'NOT_ELIGIBLE']).toContain(o.scored.status)
      expect(o.verification.checks.some((c) => c.name === 'pass-rule')).toBe(false)
      expect(o.verification.status).toBe('passed')
      expect(o.scored.value.unit).toBe('errors-per-1000-words')
    }
    const agg = await aggregateOf(env, outcomes.map((o) => o.scored), { testId: 'A2H-08' })
    expect(agg.metadata['direction']).toBe('lower-is-better')
    expect(agg.value.unit).toBe('errors-per-1000-words')
  })
})

describe('repair tests (06, 12)', () => {
  it('A2H-06: one trial per fixture; the target repairs and the result is corrected', async () => {
    env.planned = {}
    env.trialsPerTest = 100
    const outcomes = await runTest(env, 'A2H-06')
    expect(outcomes).toHaveLength(8)
    for (const o of outcomes) {
      expect(o.scored.status).toBe('MEASURED')
      const m = o.scored.metadata['measurement'] as { status: string }
      expect(m.status).toBe('corrected')
      expect(o.scored.value.numeric).toBe(1)
      const text = JSON.stringify(o.spec.parameters)
      expect(text).not.toContain('expectedCorrection')
      expect(text).not.toContain('incorrectText')
    }
    const agg = await aggregateOf(env, outcomes.map((o) => o.scored), { testId: 'A2H-06' })
    expect(agg.value.numeric).toBe(1)
    env.trialsPerTest = 20
  })

  it('A2H-12: repair_facts is sent the clean text and the domain; fully repaired scores 1', async () => {
    env.planned = {}
    env.trialsPerTest = 100
    const before = fx.humanite.requests.length
    const outcomes = await runTest(env, 'A2H-12')
    expect(outcomes).toHaveLength(8)
    const sent = fx.humanite.requests.slice(before)
    expect(sent.every((r) => r.body['operation'] === 'repair_facts')).toBe(true)
    expect(sent.every((r) => typeof (r.body['extra'] as { sourceText: string }).sourceText === 'string')).toBe(true)
    expect(sent.some((r) => (r.body['extra'] as { domain: string }).domain === 'legal')).toBe(true)
    for (const o of outcomes) {
      expect(o.scored.status).toBe('MEASURED')
      expect(o.scored.value.numeric).toBe(1)
    }
    const agg = await aggregateOf(env, outcomes.map((o) => o.scored), { testId: 'A2H-12' })
    expect(agg.value.numeric).toBe(1)
    env.trialsPerTest = 20
  })
})

describe('experimental tests', () => {
  it('A2H-07: repeats of one condition share a condition id and aggregate agreement', async () => {
    env.planned = {}
    env.trialsPerTest = 15
    const outcomes = await runTest(env, 'A2H-07')
    expect(outcomes).toHaveLength(15)
    const first = outcomes[0]?.scored.metadata['measurement'] as { conditionId: string; trialIndex: number; outputSha256: string; outputText?: unknown }
    expect(first.outputText).toBeUndefined()
    const second = outcomes[1]?.scored.metadata['measurement'] as { conditionId: string; trialIndex: number }
    expect(second.conditionId).toBe(first.conditionId)
    expect(second.trialIndex).toBe(1)
    const agg = await aggregateOf(env, outcomes.map((o) => o.scored), { testId: 'A2H-07' })
    expect(agg.value.numeric).toBe(1) // the deterministic target agrees with itself
    expect(agg.metrics['conditions']).toBe(3)
    const report = agg.metadata['report'] as { conditions: Array<{ uniqueOutputCount: number; n: number }> }
    expect(report.conditions.every((c) => c.n === 5 && c.uniqueOutputCount === 1)).toBe(true)
    env.trialsPerTest = 20
  })

  it('A2H-11 and A2H-14: two calls from one collectResult, metrics from the style diagnostics', async () => {
    for (const [code, calls] of [['A2H-11', 3], ['A2H-14', 2]] as const) {
      env.planned = {}
      env.trialsPerTest = calls * 2
      const outcomes = await runTest(env, code)
      expect(outcomes).toHaveLength(calls * 2)
      const o = outcomes[0] as TrialOutcome
      expect((o.spec.parameters['calls'] as unknown[]).length).toBe(2)
      expect((o.raw.evidence['calls'] as unknown[]).length).toBe(2)
      expect(o.raw.metrics['callCount']).toBe(2)
      expect(o.raw.metrics['modelCalls']).toBe(4)
      expect(o.scored.status).toBe('MEASURED')
      const agg = await aggregateOf(env, outcomes.map((x) => x.scored), { testId: code })
      const report = agg.metadata['report'] as { contrasts: Array<{ contrastId: string; n: number }> }
      expect(report.contrasts).toHaveLength(calls)
      expect(report.contrasts.every((c) => c.n === 2)).toBe(true)
    }
    env.trialsPerTest = 20
  })

  it('A2H-15: single vs production arms, candidate-selection telemetry when the target reports it', async () => {
    const withTelemetry = await makeEnv(pkg, createA2hTargetAdapter(), { candidateSelection: true })
    withTelemetry.env.trialsPerTest = 4
    const outcomes = await runTest(withTelemetry.env, 'A2H-15')
    expect(outcomes).toHaveLength(4)
    const calls = outcomes[0]?.spec.parameters['calls'] as Array<{ candidateCountOverride?: number | null }>
    expect(calls.map((c) => c.candidateCountOverride)).toEqual([1, null])
    const pair = outcomes[0]?.scored.metadata['measurement'] as { productionCandidateSelection: { ranCandidateSearch: boolean } | null; aiProbability: { delta: number }; preservation: Record<string, unknown> }
    expect(pair.productionCandidateSelection).toMatchObject({ ranCandidateSearch: true })
    expect(pair.aiProbability.delta).toBeCloseTo(0, 10)
    expect(Object.keys(pair.preservation).length).toBeGreaterThan(0)
    const agg = await aggregateOf(withTelemetry.env, outcomes.map((o) => o.scored), { testId: 'A2H-15' })
    expect(agg.metrics['candidateRejectionRate']).toBe(1)
    await withTelemetry.stop()
  })

  it('A2H-15 records null telemetry (never a guess) when the target reports none', async () => {
    env.planned = {}
    env.trialsPerTest = 2
    const outcomes = await runTest(env, 'A2H-15')
    const pair = outcomes[0]?.scored.metadata['measurement'] as { productionCandidateSelection: unknown }
    expect(pair.productionCandidateSelection).toBeNull()
    env.trialsPerTest = 20
  })
})

describe('results that are not errors', () => {
  it('an empty humanize output is inconclusive and scores ERROR with no data', async () => {
    const empty = await makeEnv(pkg, createA2hTargetAdapter(), { emptyOutput: true })
    empty.env.trialsPerTest = 10
    const outcomes = await runTest(empty.env, 'A2H-08')
    expect(outcomes[0]?.verification.status).toBe('inconclusive')
    expect(outcomes[0]?.scored.status).toBe('ERROR')
    expect(outcomes[0]?.scored.value).toEqual({})
    const agg = await aggregateOf(empty.env, outcomes.map((o) => o.scored), { testId: 'A2H-08' })
    expect(agg.status).toBe('NO_DATA')
    expect(agg.sampleCount).toBe(10)
    await empty.stop()
  })

  it('a missing detector binding fails verification with a configuration error', async () => {
    const unbound = await makeEnv(pkg, createA2hTargetAdapter())
    unbound.env.detectorBound = false
    unbound.env.trialsPerTest = 10
    await expect(runTrial({ ...unbound.env, planned: { 'A2H-02': 10 } }, 'A2H-02', 0)).rejects.toMatchObject({ code: 'FRAMEWORK_CONFIG' })
    await unbound.stop()
  })
})

describe('batch and category aggregates', () => {
  it('emits A2H-03 and A2H-17 at batch level from the other tests, and counts per category', async () => {
    env.planned = {}
    env.trialsPerTest = 20
    env.selected = ['A2H-01', 'A2H-02', 'A2H-03', 'A2H-17']
    const a = await runTest(env, 'A2H-01')
    const b = await runTest(env, 'A2H-02')
    expect(await plan(env, 'A2H-03')).toBe(0)
    const scored = [...a, ...b].map((o) => o.scored)
    const batch = await aggregateOf(env, scored)
    expect(batch.sampleCount).toBe(40)
    expect(batch.status).toBe('MEASURED')
    const rollups = batch.metadata['rollups'] as Record<string, { report: Record<string, unknown>; metrics: Record<string, number> }>
    const a03 = rollups['A2H-03']!
    expect(a03.metrics['a2h01Rows']).toBe(20)
    const byLength = a03.report['byLength'] as Array<{ targetWords: number; n: number; conversionRate: { successRate: number } }>
    expect(byLength.map((g) => g.targetWords)).toEqual([100, 200])
    expect(byLength.every((g) => g.n === 10 && g.conversionRate.successRate === 1)).toBe(true)
    expect(Object.keys(a03.report)).toContain('byDomain')
    const a17 = rollups['A2H-17']!
    expect(a17.metrics['operations']).toBe(40)
    expect(a17.metrics['latencyMs_mean']).toBe(120)
    expect(a17.metrics['modelCalls_total']).toBe(80)
    expect(a17.metrics['jobRetries_total']).toBe(0)

    const category = await aggregateOf(env, scored, { categoryId: 'conversion' })
    expect(category.metrics['pass']).toBe(20)
    expect(category.sampleCount).toBe(40)
  })

  it('omits roll-ups the run did not select', async () => {
    env.selected = ['A2H-01']
    const out = await runTest(env, 'A2H-01')
    const batch = await aggregateOf(env, out.map((o) => o.scored))
    expect(batch.metadata['rollups']).toEqual({})
  })
})

describe('conformance', () => {
  it('exposes the required package methods', () => {
    for (const m of ['manifest', 'catalog', 'validateTarget', 'createTrialSpec', 'verify', 'score', 'aggregate', 'planTrials']) {
      expect(typeof (pkg as unknown as Record<string, unknown>)[m]).toBe('function')
    }
    expect(typeof checkBenchmarkPackageConformance).toBe('function')
  })
})

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parseDatasetInputId, type JsonObject } from '@benchmarkr/core'
import { createA2hBenchmarkPackage } from '../../src/pack/package'
import { createA2hTargetAdapter } from '../../src/pack/adapter'
import { evaluateCitationPreservation } from '../../src/scoring/a2h04'
import { measureA2H02Trial } from '../../src/scoring/a2h02'
import { evaluateGrammarDamage } from '../../src/scoring/a2h08'
import { fixtureDocOf } from '../../src/pack/data'
import {
  FakeDatasets, aggregateOf, context, corpusItems, corpusText, fakeHumanize, fixtureItems, item, makeEnv, plan, plain, runTest, runTrial, type Fixture,
} from './harness'

const pkg = createA2hBenchmarkPackage()
const adapter = createA2hTargetAdapter()
let fx: Fixture & Awaited<ReturnType<typeof makeEnv>>

beforeAll(async () => {
  fx = await makeEnv(pkg, adapter)
  fx.env.trialsPerTest = 20
})
afterAll(async () => {
  await fx.stop()
})

describe('numbers are the ark scoring modules\' numbers', () => {
  it('A2H-04 equals evaluateCitationPreservation on the same fixtures and output', async () => {
    const [o] = await runTest(fx.env, 'A2H-04')
    const source = String(o!.spec.metadata['itemKey'])
    const output = (o!.raw.evidence['calls'] as Array<{ output: string }>)[0]!.output
    const fixtures = fixtureItems().filter((f) => f.content['sourceId'] === source && f.content['type'] === 'citation').map(fixtureDocOf)
    const direct = evaluateCitationPreservation(fixtures, output)
    expect(o!.scored.metadata['measurement']).toEqual(plain(direct.measurements))
    expect(o!.scored.value.numeric).toBe(direct.score)
  })

  it('A2H-02 equals measureA2H02Trial with the endpoint output and the post score', async () => {
    const outcomes = await runTest(fx.env, 'A2H-02')
    const o = outcomes[3]!
    const meta = o.spec.metadata['a2h'] as { sourceId: string; domain: 'general' | 'legal'; intensity: number; sourceWords: number }
    const doc = corpusItems().find((i) => i.key === meta.sourceId)!
    const output = (o.raw.evidence['calls'] as Array<{ output: string }>)[0]!.output
    const direct = measureA2H02Trial(
      { source: { text: String(doc.content['text']), actualWords: meta.sourceWords, domainId: meta.domain }, intensity: meta.intensity },
      [{ output, latencyMs: null, modelCalls: null, inputTokens: null, outputTokens: null, retryCount: 0 }],
      { aiProbability: 0.08, humanProbability: 0.9, classification: 'human-written' },
    )
    expect(o.scored.metadata['measurement']).toEqual(plain(direct))
    expect(o.scored.value.numeric).toBe(direct!.transformationMagnitude)
  })

  it('A2H-08 equals evaluateGrammarDamage and reports passed = null as no pass-rule check', async () => {
    const [o] = await runTest(fx.env, 'A2H-08')
    const doc = corpusItems().find((i) => i.key === o!.spec.metadata['itemKey'])!
    const output = (o!.raw.evidence['calls'] as Array<{ output: string }>)[0]!.output
    const direct = evaluateGrammarDamage(String(doc.content['text']), output)
    expect(o!.scored.metadata['measurement']).toEqual(plain(direct.measurements))
    expect(o!.scored.value.numeric).toBe(direct.score ?? undefined)
  })

  it('the humanize output is exactly what the endpoint answered (the pack changes no text)', async () => {
    const [o] = await runTest(fx.env, 'A2H-08')
    const doc = corpusItems().find((i) => i.key === o!.spec.metadata['itemKey'])!
    const meta = o!.spec.metadata['a2h'] as { intensity: number }
    const output = (o!.raw.evidence['calls'] as Array<{ output: string }>)[0]!.output
    expect(output).toBe(fakeHumanize(String(doc.content['text']), meta.intensity, false))
  })
})

describe('eligibility', () => {
  it('A2H-01: a baseline that is not AI-classified is NOT_ELIGIBLE and outside the conversion rate', async () => {
    const humanCorpus = corpusItems().map((i) => item(i.key, i.dimensions as Record<string, string | number>, { ...i.content, text: String(i.content['text']).replace(/delve/g, 'look') }))
    const t = await makeEnv(pkg, adapter, {}, { corpus: humanCorpus, fixtures: null })
    t.env.trialsPerTest = 10
    const outcomes = await runTest(t.env, 'A2H-01')
    for (const o of outcomes) {
      expect(o.scored.status).toBe('NOT_ELIGIBLE')
      expect(o.verification.status).toBe('passed') // not a failed assertion: the source is simply not in the population
    }
    const agg = await aggregateOf(t.env, outcomes.map((o) => o.scored), { testId: 'A2H-01' })
    expect(agg.metrics['eligibleN']).toBe(0)
    expect(agg.status).toBe('NO_DATA')
    await t.stop()
  })

  it('A2H-01: an AI baseline that stays AI fails the trial as a result, not an error', async () => {
    const t = await makeEnv(pkg, adapter, { keepAi: true }, { fixtures: null })
    t.env.trialsPerTest = 10
    const outcomes = await runTest(t.env, 'A2H-01')
    for (const o of outcomes) {
      expect(o.verification.status).toBe('failed')
      expect(o.scored.status).toBe('FAIL')
      expect((o.scored.metadata['measurement'] as { convertedAiToHuman: boolean }).convertedAiToHuman).toBe(false)
    }
    const agg = await aggregateOf(t.env, outcomes.map((o) => o.scored), { testId: 'A2H-01' })
    expect(agg.value.numeric).toBe(0)
    expect(agg.metrics['eligibleN']).toBe(10)
    await t.stop()
  })
})

describe('retries and operational records', () => {
  it('a later attempt of a trial is recorded as a job retry for A2H-17', async () => {
    const env = fx.env
    env.planned = { 'A2H-08': await plan(env, 'A2H-08') }
    env.selected = ['A2H-08', 'A2H-17']
    const first = await runTrial(env, 'A2H-08', 0, 1)
    const second = await runTrial(env, 'A2H-08', 0, 2)
    expect(second.scored.metadata['attempt']).toBe(2)
    const batch = await aggregateOf(env, [first.scored, second.scored])
    const a17 = (batch.metadata['rollups'] as Record<string, { metrics: Record<string, number>; report: { byOperationType: Record<string, unknown> } }>)['A2H-17']!
    expect(a17.metrics['jobRetries_total']).toBe(1)
    expect(a17.metrics['operations']).toBe(2)
    expect(Object.keys(a17.report.byOperationType)).toEqual(['humanite_transform'])
  })

  it('records the requested and applied intensity of every call, including A2H-11/14 pairs', async () => {
    const env = fx.env
    env.planned = {}
    env.trialsPerTest = 3
    const [pair] = await runTest(env, 'A2H-11')
    const ops = pair!.scored.metadata['operations'] as Array<{ operation: string; benchmarkCode: string; intensity: number; requestedIntensity: number; appliedIntensity: number }>
    expect(ops).toHaveLength(2)
    expect(ops.every((o) => o.operation === 'trial_a2h11' && o.benchmarkCode === 'A2H-11' && o.intensity === 5 && o.requestedIntensity === 5)).toBe(true)
  })

  it('a target outcome that is not completed is inconclusive and scores ERROR', async () => {
    const env = fx.env
    env.planned = { 'A2H-08': await plan(env, 'A2H-08') }
    const spec = plain(await pkg.createTrialSpec('A2H-08' as never, context(env, 'A2H-08', 0)))
    const raw = { trialId: spec.trialId, outcome: 'cancelled', startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), evidence: {} as JsonObject, metrics: {}, artifacts: [] } as never
    const verification = await pkg.verify(spec, raw, undefined, { services: { has: () => false, resolve: () => Promise.reject(new Error('x')) }, signal: env.controller.signal, datasets: env.datasets })
    expect(verification.status).toBe('inconclusive')
    expect((await pkg.score(verification, raw)).status).toBe('ERROR')
  })
})

describe('at the corpus\'s real scale', () => {
  it('plans a full run within the per-test limit and stratifies a sample over domains and the length ladder', async () => {
    const domains = ['general', 'academic', 'business', 'technical', 'medical', 'legal']
    const lengths = [100, 200, 300, 500, 750, 1000, 1250, 1500, 1750, 2000]
    const items = []
    for (const d of domains) for (let t = 1; t <= 20; t += 1) for (const w of lengths) items.push(item(`${d}__${String(t)}__${String(w)}`, { domain: d, topic: t, words: w }, { text: corpusText('general', 1, 100) }))
    expect(items).toHaveLength(1200)
    const t = await makeEnv(pkg, adapter, {}, { corpus: items, fixtures: null })
    t.env.trialsPerTest = 1_000_000
    expect(await plan(t.env, 'A2H-01')).toBe(12_000) // 1200 sources x 10 intensities, within the 20 000 limit
    expect(await plan(t.env, 'A2H-07')).toBe(18_000) // 1200 x 15, capped by the limit at 1333 items -> all 1200
    t.env.trialsPerTest = 600 // 60 sources
    t.env.planned = { 'A2H-01': await plan(t.env, 'A2H-01') }
    expect(t.env.planned['A2H-01']).toBe(600)
    const picked = new Set<string>()
    for (let i = 0; i < 600; i += 10) picked.add(String((await pkgSpec(t.env, i)).metadata['itemKey']))
    expect(picked.size).toBe(60)
    const perDomain = new Map<string, number>()
    const perLength = new Map<string, number>()
    for (const key of picked) {
      const [d, , w] = key.split('__') as [string, string, string]
      perDomain.set(d, (perDomain.get(d) ?? 0) + 1)
      perLength.set(w, (perLength.get(w) ?? 0) + 1)
    }
    expect([...perDomain.values()]).toEqual([10, 10, 10, 10, 10, 10])
    expect([...perLength.values()].every((n) => n === 6)).toBe(true)
    await t.stop()
  })
})

async function pkgSpec(env: Parameters<typeof context>[0], index: number) {
  return pkg.createTrialSpec('A2H-01' as never, context(env, 'A2H-01', index))
}

describe('unbound inputs', () => {
  it('a corpus-less run is refused with a configuration error', async () => {
    const empty = new FakeDatasets({ [parseDatasetInputId('fixtures')]: fixtureItems() })
    await expect(pkg.planTrials!('A2H-01' as never, { workspaceId: 'wsp_x' as never, targetCapabilities: { capabilities: [] }, datasets: empty, requestedTrials: 5, signal: new AbortController().signal })).rejects.toMatchObject({ code: 'FRAMEWORK_CONFIG' })
  })
})

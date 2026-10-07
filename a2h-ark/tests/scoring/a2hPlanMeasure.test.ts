import { describe, it, expect } from 'vitest'
import type { TargetCallResult } from '../../src/shared/targetCalls'
import type { DetectorScore } from '../../src/scoring/trialCommon'
import { planA2H01Trial, measureA2H01Trial, buildA2H01Report, type A2H01Row } from '../../src/scoring/a2h01'
import { planA2H02Trial, measureA2H02Trial, buildA2H02Report, type A2H02Row } from '../../src/scoring/a2h02'
import { buildA2H03Report } from '../../src/scoring/a2h03'
import { planA2H07Trial, measureA2H07Trial, buildA2H07Report, type A2H07TrialInput } from '../../src/scoring/a2h07'
import { planA2H15Trial, measureA2H15Trial, computeCandidateSelectionPairMeasurements, buildA2H15Report, a2h15ConditionId, parseA2H15ConditionId, type A2H15TrialInput } from '../../src/scoring/a2h15'
import { buildA2H17Report, operationRecordFromCall, looksLikeTimeout } from '../../src/scoring/a2h17'

const SOURCE_TEXT = 'The quick brown fox jumps over the lazy dog near the riverbank every single morning without fail.'

function result(overrides: Partial<TargetCallResult> = {}): TargetCallResult {
  return { output: 'A fox jumps over a dog by the river each morning.', latencyMs: 1200, modelCalls: 2, inputTokens: 300, outputTokens: 120, retryCount: 1, candidateCount: 2, modelUsed: 'gpt-x', ...overrides }
}
function score(overrides: Partial<DetectorScore> = {}): DetectorScore {
  return { aiProbability: 0.2, humanProbability: 0.7, mixedProbability: 0.1, classification: 'human-written', analyzedAt: '2026-01-01T00:00:00.000Z', runId: 'run-1', ...overrides }
}

describe('A2H-01 / A2H-02 plan and measure', () => {
  it('plans exactly one humanize call at the requested intensity, fixed tone and the source domain', () => {
    expect(planA2H01Trial({ sourceText: SOURCE_TEXT, domain: 'medical', intensity: 9 })).toEqual([
      { operation: 'humanize', text: SOURCE_TEXT, settings: { intensity: 9, tone: 'balanced', domain: 'medical' } },
    ])
    const calls = planA2H02Trial({ source: { text: SOURCE_TEXT, actualWords: 17, domainId: 'general' }, intensity: 3 })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.candidateCountOverride).toBeUndefined()
  })

  it('A2H-01 measure only makes baseline-AI sources eligible and reports the output text', () => {
    const m = measureA2H01Trial([result()], score({ classification: 'mixed', aiProbability: 0.5, runId: 'old' }), score())!
    expect(m.outputText).toBe(result().output)
    expect(m.measurements.eligibleForConversion).toBe(false)
    expect(m.measurements.convertedAiToHuman).toBeNull()
    expect(m.measurements.baselineReusedAcrossRuns).toBe(true)
    expect(measureA2H01Trial([], score(), score())).toBeNull()
  })

  it('A2H-02 measure records the REQUESTED intensity plus the applied (domain-capped) intensity', () => {
    const source = { text: SOURCE_TEXT, actualWords: 17, domainId: 'medical' as const }
    const capped = measureA2H02Trial({ source, intensity: 9 }, [result()], score())!
    expect(capped.intensity).toBe(9)
    expect(capped.requestedIntensity).toBe(9)
    expect(capped.appliedIntensity).toBe(5)
    expect(capped.intensityCapped).toBe(true)
    const uncapped = measureA2H02Trial({ source, intensity: 4 }, [result()], score())!
    expect(uncapped.appliedIntensity).toBe(4)
    expect(uncapped.intensityCapped).toBe(false)
    expect(measureA2H02Trial({ source, intensity: 4 }, [], score())).toBeNull()
  })

  it('A2H-02 word counts come from the output text; zero source words give a 0 percentage', () => {
    const m = measureA2H02Trial({ source: { text: '', actualWords: 0, domainId: 'general' }, intensity: 2 }, [result({ output: 'one two three' })], score())!
    expect(m.outputWords).toBe(3)
    expect(m.wordCountDelta).toBe(3)
    expect(m.wordCountDeltaPct).toBe(0)
  })
})

describe('report builders', () => {
  const m01 = measureA2H01Trial([result()], score({ classification: 'ai-generated', aiProbability: 0.9 }), score())!.measurements
  const row01 = (o: Partial<A2H01Row> = {}): A2H01Row => ({ sourceId: 's', outputId: 'o', domainId: 'general', topicId: 't', targetWords: 100, intensity: 5, model: 'm', measurements: m01, ...o })
  const m02 = measureA2H02Trial({ source: { text: SOURCE_TEXT, actualWords: 17, domainId: 'general' }, intensity: 5 }, [result()], score())!
  const row02 = (o: Partial<A2H02Row> = {}): A2H02Row => ({ sourceId: 's', outputId: 'o', domainId: 'general', topicId: 't', targetWords: 100, intensity: 5, appliedIntensity: 5, intensityCapped: false, model: 'm', measurements: m02, ...o })

  it('A2H-01 report groups by intensity/domain/length/topic/model and filters rows', () => {
    const rows = [row01(), row01({ intensity: 7, domainId: 'legal', targetWords: 500, topicId: 'u', model: 'n' })]
    const report = buildA2H01Report(rows)
    expect(Object.keys(report.byIntensity).sort()).toEqual(['5', '7'])
    expect(Object.keys(report.byDomain).sort()).toEqual(['general', 'legal'])
    expect(Object.keys(report.byLength).sort()).toEqual(['100', '500'])
    expect(Object.keys(report.byTopic).sort()).toEqual(['t', 'u'])
    expect(Object.keys(report.byModel).sort()).toEqual(['m', 'n'])
    expect(buildA2H01Report(rows, { domainId: 'legal' }).rows).toHaveLength(1)
    expect(buildA2H01Report(rows, { classificationAfter: 'ai-generated' }).rows).toHaveLength(0)
  })

  it('A2H-02 report has requested and applied groupings and a trend', () => {
    const rows = [row02({ intensity: 6, appliedIntensity: 5, intensityCapped: true }), row02({ intensity: 9, appliedIntensity: 5, intensityCapped: true }), row02()]
    const report = buildA2H02Report(rows)
    expect(Object.keys(report.byIntensity).sort()).toEqual(['5', '6', '9'])
    expect(Object.keys(report.byAppliedIntensity)).toEqual(['5'])
    expect(report.byAppliedIntensity[5]!.n).toBe(3)
    expect(report.trend).not.toBeNull()
  })

  it('A2H-03 report applies the filter object to each test with its own matcher (intensity filters A2H-01 rows only)', () => {
    const report = buildA2H03Report([row01({ intensity: 5 }), row01({ intensity: 7 })], [row02({ intensity: 5 }), row02({ intensity: 7 })], { intensity: 5 }, 'intensity')
    expect(report.byLength).toHaveLength(1)
    expect(report.byLength[0]!.n).toBe(2) // 1 A2H-01 row, 2 A2H-02 rows (intensity ignored there): max
    expect(report.stratified!.map(g => g.stratum!.value)).toEqual([5, 7])
  })
})

describe('A2H-07 plan and measure', () => {
  const input: A2H07TrialInput = { sourceId: 'src-1', sourceText: SOURCE_TEXT, domain: 'legal', intensity: 8, conditionId: 'c1', trialIndex: 2, model: 'cfg-model', modelProvider: 'openai', humaniteVersion: 'v1' }

  it('plans one humanize call at the requested intensity (the target applies the cap)', () => {
    expect(planA2H07Trial(input)).toEqual([{ operation: 'humanize', text: SOURCE_TEXT, settings: { intensity: 8, tone: 'balanced', domain: 'legal' } }])
  })

  it('records requested/applied/capped in the condition, the output hash and the detector fields', () => {
    const t = measureA2H07Trial(input, [result()], score({ aiProbability: 0.33, classification: 'mixed' }))
    expect(t.status).toBe('success')
    expect(t.condition).toMatchObject({ intensity: 8, requestedIntensity: 8, appliedIntensity: 4, intensityCapped: true, model: 'cfg-model', humaniteVersion: 'v1' })
    expect(t.outputSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(t.model).toBe('gpt-x')
    expect(t.aiProbability).toBe(0.33)
    expect(t.classification).toBe('mixed')
    expect(typeof t.diagnostics!['transformationMagnitude']).toBe('number')
  })

  it('falls back to the configured model and null detector fields when absent', () => {
    const t = measureA2H07Trial(input, [(({ modelUsed: _m, ...rest }) => rest)(result())], null)
    expect(t.model).toBe('cfg-model')
    expect(t.aiProbability).toBeNull()
    expect(t.classification).toBeNull()
  })

  it('a failed trial (error or no result) has every measurement null and is excluded from aggregation', () => {
    const failed = measureA2H07Trial(input, [], null, { errorCode: 'TimeoutError', errorMessage: 'timeout' })
    expect(failed).toMatchObject({ status: 'failed', outputText: null, outputSha256: null, aiProbability: null, diagnostics: null, model: 'cfg-model', errorCode: 'TimeoutError' })
    const ok = measureA2H07Trial(input, [result()], score())
    const report = buildA2H07Report([failed, ok])
    expect(report.conditions).toHaveLength(1)
    expect(report.conditions[0]!.n).toBe(1)
    expect(report.conditions[0]!.intensity).toBe(8)
  })

  it('report averages per-condition CVs and agreement, sorted by source then intensity', () => {
    const mk = (idx: number, out: string, ai: number) => measureA2H07Trial({ ...input, trialIndex: idx }, [result({ output: out })], score({ aiProbability: ai }))
    const report = buildA2H07Report([mk(0, 'a b c', 0.2), mk(1, 'a b d', 0.4), measureA2H07Trial({ ...input, sourceId: 'src-0', conditionId: 'c0' }, [result()], score())])
    expect(report.conditionsEvaluated).toBe(2)
    expect(report.conditions.map(c => c.sourceId)).toEqual(['src-0', 'src-1'])
    expect(report.repeatsPerCondition).toBe(2)
    expect(report.meanClassificationAgreement).toBe(1)
  })
})

describe('A2H-15 plan and measure', () => {
  const input: A2H15TrialInput = { sourceId: 'src-1', sourceText: SOURCE_TEXT, domain: 'general', intensity: 6, arm: 'single', model: 'cfg-model', modelProvider: 'openai' }

  it('single arm forces candidateCountOverride 1; production arm passes null; both share identical settings', () => {
    const single = planA2H15Trial(input)
    const production = planA2H15Trial({ ...input, arm: 'production' })
    expect(single[0]!.candidateCountOverride).toBe(1)
    expect(production[0]!.candidateCountOverride).toBeNull()
    expect(single[0]!.settings).toEqual(production[0]!.settings)
    expect(single[0]!.operation).toBe('humanize')
  })

  it('condition ids round-trip', () => {
    expect(parseA2H15ConditionId(a2h15ConditionId(6, 'production'))).toEqual({ intensity: 6, arm: 'production' })
    expect(parseA2H15ConditionId('nonsense')).toBeNull()
  })

  it('records the same applied intensity for both arms and the candidate-selection telemetry', () => {
    const sel = { ranCandidateSearch: true, candidateCount: 2, disqualifiedAt: null }
    const dom = { ...input, domain: 'legal' as const, intensity: 9 }
    const a = measureA2H15Trial({ ...dom, arm: 'single' }, [result()], score())
    const b = measureA2H15Trial({ ...dom, arm: 'production' }, [{ ...result(), candidateSelection: sel }], score())
    expect(a.condition['appliedIntensity']).toBe(4)
    expect(b.condition['appliedIntensity']).toBe(4)
    expect(b.condition['intensityCapped']).toBe(true)
    expect(b.diagnostics!['candidateSelection']).toEqual(sel)
    expect(a.diagnostics!['candidateSelection']).toBeNull()
  })

  it('pair measurement: grammar delta only when both arms are eligible; null deltas propagate; preservation only when both have text', () => {
    const t = (o: Partial<ReturnType<typeof measureA2H15Trial>>) => ({ ...measureA2H15Trial(input, [result()], score({ aiProbability: 0.4 })), ...o })
    const single = t({})
    const production = t({ aiProbability: 0.1, latencyMs: 2000 })
    const scorers = {
      grammarDamage: (text: string) => ({ eligible: text === single.outputText, newErrorsPer1000: 3 }),
      preservationScores: () => ({ 'A2H-04': 1 as number | null, 'A2H-05': null }),
    }
    const pair = computeCandidateSelectionPairMeasurements('src-1', 6, single, production, scorers)
    expect(pair.aiProbability.delta).toBeCloseTo(-0.3, 10)
    expect(pair.latencyMs.delta).toBe(800)
    expect(pair.grammarDamageNewErrorsPer1000).toEqual({ single: 3, production: 3, delta: 0 })
    expect(pair.preservation['A2H-04']).toEqual({ single: 1, production: 1, delta: 0 })
    expect(pair.preservation['A2H-05']).toEqual({ single: null, production: null, delta: null })
    expect(pair.preservation['A2H-09']).toBeUndefined()
    expect(pair.productionCandidateSelection).toBeNull()

    const noText = computeCandidateSelectionPairMeasurements('src-1', 6, { ...single, outputText: null }, production, scorers)
    expect(noText.preservation).toEqual({})
  })

  it('report pairs only successful trials with both arms', () => {
    const mk = (arm: 'single' | 'production', sourceId: string) => measureA2H15Trial({ ...input, arm, sourceId }, [result()], score())
    const failed = measureA2H15Trial({ ...input, arm: 'production', sourceId: 'src-3' }, [], null, { errorCode: 'E', errorMessage: 'x' })
    const report = buildA2H15Report(
      [mk('single', 'src-1'), mk('production', 'src-1'), mk('single', 'src-2'), mk('single', 'src-3'), failed],
      () => ({ grammarDamage: () => ({ eligible: false, newErrorsPer1000: 0 }) }),
    )
    expect(report.pairs).toHaveLength(1)
    expect(report.pairs[0]!.sourceId).toBe('src-1')
    expect(report.overall.n).toBe(1)
  })
})

describe('A2H-17 roll-up', () => {
  it('groups by every dimension and skips records with a null key', () => {
    const base = { benchmarkCode: null, requestedIntensity: null, appliedIntensity: null, intensityCapped: null, estimatedCostUsd: null, errorCode: null, errorMessage: null, jobAttemptCount: 1 } as const
    const a = operationRecordFromCall({ ...base, operation: 'humanite_transform', domainId: 'general', targetWords: 100, intensity: 5, model: 'm1', status: 'success' }, result())
    const b = operationRecordFromCall({ ...base, operation: 'repair', benchmarkCode: 'A2H-06', domainId: null, targetWords: null, intensity: null, model: 'm2', status: 'failed', errorMessage: 'Request timed out', jobAttemptCount: 3 }, result({ latencyMs: null }))
    const report = buildA2H17Report([a, b])
    expect(report.overall.n).toBe(2)
    expect(Object.keys(report.byDomain)).toEqual(['general'])
    expect(Object.keys(report.byLength)).toEqual(['100'])
    expect(Object.keys(report.byIntensity)).toEqual(['5'])
    expect(Object.keys(report.byModel).sort()).toEqual(['m1', 'm2'])
    expect(Object.keys(report.byBenchmarkTest)).toEqual(['A2H-06'])
    expect(Object.keys(report.byOperationType).sort()).toEqual(['humanite_transform', 'repair'])
    expect(b.timedOut).toBe(true)
    expect(b.jobRetryCount).toBe(2)
    expect(a.pipelineRetryCount).toBe(1)
    expect(report.overall.latencyMs.mean).toBe(1200)
    expect(report.overall.timeouts.count).toBe(1)
  })

  it('a record with no correlating job has null job retry fields', () => {
    const r = operationRecordFromCall({ operation: 'trial_a2h07', benchmarkCode: 'A2H-07', domainId: null, targetWords: null, intensity: 3, requestedIntensity: 3, appliedIntensity: 3, intensityCapped: false, model: 'm', estimatedCostUsd: null, status: 'success', errorCode: null, errorMessage: null, jobAttemptCount: null }, result())
    expect(r.jobAttemptCount).toBeNull()
    expect(r.jobRetryCount).toBeNull()
    expect(looksLikeTimeout('TimeoutError', null)).toBe(true)
    expect(looksLikeTimeout(null, 'ok')).toBe(false)
  })
})

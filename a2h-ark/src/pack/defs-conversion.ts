// A2H-01 (conversion) and A2H-02 (intensity response): one ordinary Humanize call per (source, intensity), scored
// with the detector (post-transform) and, for A2H-01, the memoised baseline score of the frozen source.
import { measureA2H01Trial, planA2H01Trial, buildA2H01Report, type A2H01Measurements, type A2H01Row } from '../scoring/a2h01'
import { measureA2H02Trial, planA2H02Trial, buildA2H02Report, type A2H02Measurements, type A2H02Row } from '../scoring/a2h02'
import { baselineScore, detectText, resolveDetector } from './detector'
import { baseMeta, domainOf, intensityOf, parts, requireDoc, scoreFromJson, scoreToJson, summaryMetrics, withoutRows } from './defs-common'
import { configError, toJsonObject } from './util'
import type { ScoredItem, TestDef } from './suite'

export function rows01(items: readonly ScoredItem[]): A2H01Row[] {
  return items.map((i) => ({
    sourceId: i.meta.sourceId,
    outputId: i.trialId,
    domainId: domainOf(i.meta),
    topicId: i.meta.topicId,
    targetWords: i.meta.targetWords,
    intensity: intensityOf(i.meta),
    model: i.model,
    measurements: i.measurement as unknown as A2H01Measurements,
  }))
}

export function rows02(items: readonly ScoredItem[]): A2H02Row[] {
  return items.map((i) => {
    const m = i.measurement as unknown as A2H02Measurements
    return {
      sourceId: i.meta.sourceId,
      outputId: i.trialId,
      domainId: domainOf(i.meta),
      topicId: i.meta.topicId,
      targetWords: i.meta.targetWords,
      intensity: intensityOf(i.meta),
      appliedIntensity: m.appliedIntensity,
      intensityCapped: m.intensityCapped,
      model: i.model,
      measurements: m,
    }
  })
}

export const a2h01: TestDef = {
  code: 'A2H-01',
  category: 'conversion',
  description:
    'For each frozen source: the detector scores the source (baseline, shared across runs), Humanite transforms it at intensity N, and the detector scores the output. Reports how often a baseline-AI source ends up classified human-written, and how far the AI probability moved.',
  defaultEnabled: true,
  experimental: false,
  needsDetector: true,
  needsFixtures: false,
  timeoutMs: 600_000,
  defaultTrialCount: 50,
  design: (o) => ({ pool: 'corpus', cohort: 'main', cells: o.intensities.length }),
  buildSpec({ doc, cell }, o) {
    const source = requireDoc(doc)
    const intensity = o.intensities[cell] as number
    return {
      calls: planA2H01Trial({ sourceText: source.text, domain: source.domain, intensity }),
      meta: baseMeta('A2H-01', source, { intensity }),
    }
  },
  async detect(ctx, services, batchId) {
    const detector = await resolveDetector(services)
    const output = ctx.results[0]?.output ?? ''
    const { score: baseline, cached } = await baselineScore(ctx.runtime?.memo, ctx.meta.itemHash, ctx.sourceText, detector, ctx.runtime?.signal, batchId)
    const post = await detectText(output, detector, ctx.runtime?.signal)
    return { baseline: scoreToJson(baseline), baselineCached: cached, post: scoreToJson({ ...post, runId: batchId }), detectorConfigId: detector.configId }
  },
  evaluate(ctx, detected) {
    const measured = measureA2H01Trial([...ctx.results], scoreFromJson(detected?.['baseline']), scoreFromJson(detected?.['post']))
    if (measured === null) throw configError('The target produced no output')
    const m = measured.measurements
    return Promise.resolve({
      passed: m.convertedAiToHuman,
      numeric: m.deltaAiProbability,
      unit: 'probability-delta',
      eligible: m.eligibleForConversion,
      measurement: toJsonObject(m),
    })
  },
  aggregate(items) {
    const report = withoutRows(buildA2H01Report(rows01(items)))
    const o = report.overall
    return parts({
      numeric: o.conversionRate.successRate,
      unit: 'ratio',
      direction: 'higher-is-better',
      metrics: {
        n: o.n,
        eligibleN: o.nEligible,
        converted: o.nConverted,
        conversionRate: o.conversionRate.successRate,
        conversionRate_ciLow95: o.conversionRate.ciLow95,
        conversionRate_ciHigh95: o.conversionRate.ciHigh95,
        ...summaryMetrics('deltaAiProbability', o.deltaAiProbability),
      },
      report,
    })
  },
}

export const a2h02: TestDef = {
  code: 'A2H-02',
  category: 'conversion',
  description:
    'The same frozen source transformed at every selected intensity, measuring how much the transformation itself changed (token-edit ratio, lexical replacement, sentence and paragraph changes) as the requested intensity rises, with the intensity the target actually applied after its domain cap.',
  defaultEnabled: true,
  experimental: false,
  needsDetector: true,
  needsFixtures: false,
  timeoutMs: 600_000,
  defaultTrialCount: 50,
  design: (o) => ({ pool: 'corpus', cohort: 'main', cells: o.intensities.length }),
  buildSpec({ doc, cell }, o) {
    const source = requireDoc(doc)
    const intensity = o.intensities[cell] as number
    return {
      calls: planA2H02Trial({ source: { text: source.text, actualWords: source.actualWords, domainId: source.domain }, intensity }),
      meta: baseMeta('A2H-02', source, { intensity }),
    }
  },
  async detect(ctx, services, batchId) {
    const detector = await resolveDetector(services)
    const post = await detectText(ctx.results[0]?.output ?? '', detector, ctx.runtime?.signal)
    return { post: scoreToJson({ ...post, runId: batchId }), detectorConfigId: detector.configId }
  },
  evaluate(ctx, detected) {
    const m = measureA2H02Trial(
      { source: { text: ctx.sourceText, actualWords: ctx.meta.sourceWords, domainId: domainOf(ctx.meta) }, intensity: intensityOf(ctx.meta) },
      [...ctx.results],
      scoreFromJson(detected?.['post']),
    )
    if (m === null) throw configError('The target produced no output')
    return Promise.resolve({ passed: null, numeric: m.transformationMagnitude, unit: 'magnitude', eligible: true, measurement: toJsonObject(m) })
  },
  aggregate(items) {
    const report = withoutRows(buildA2H02Report(rows02(items)))
    const o = report.overall
    return parts({
      numeric: o.transformationMagnitude.mean,
      unit: 'magnitude',
      metrics: {
        n: o.n,
        ...summaryMetrics('transformationMagnitude', o.transformationMagnitude),
        ...summaryMetrics('aiProbability', o.aiProbability),
        postConversionRate: o.conversionRate.successRate,
        trendCorrelation: report.trend?.correlation,
      },
      report,
    })
  },
}

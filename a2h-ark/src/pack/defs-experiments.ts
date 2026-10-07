// The experimental trial tests: A2H-07 (repeatability), A2H-11 (style/tone control), A2H-14 (genre/audience) and
// A2H-15 (candidate selection). One trial is one cell of the design: a repeat, or a left/right pair of calls, or a
// single/production pair of calls, returned by one collectResult.
import { FrameworkError } from '@benchmarkr/core'
import {
  buildA2H07Report,
  measureA2H07Trial,
  planA2H07Trial,
  repeatabilityConditionId,
  type A2H07TrialInput,
  type RepeatabilityTrial,
} from '../scoring/a2h07'
import { buildA2H11Report, measureA2H11Trial, planA2H11Trial, type StyleTonePairMeasurements } from '../scoring/a2h11'
import { buildA2H14Report, measureA2H14Trial, planA2H14Trial, type GenreAudiencePairMeasurements } from '../scoring/a2h14'
import {
  A2H15_PRESERVATION_CODES,
  aggregateA2H15,
  computeCandidateSelectionPairMeasurements,
  measureA2H15Trial,
  planA2H15Trial,
  type A2H15Arm,
  type A2H15Trial,
  type A2H15TrialInput,
  type CandidateSelectionPairMeasurements,
  type CandidateSelectionTelemetry,
} from '../scoring/a2h15'
import type { A2H15TargetResult } from '../scoring/a2h15'
import { DETERMINISTIC_EVALUATORS } from '../scoring/deterministicEvaluators'
import { evaluateGrammarDamage } from '../scoring/a2h08'
import type { A2HTestCode, GenreAudienceContrast, StyleToneContrast } from '../shared/types'
import { FIXTURE_TYPE_FOR_TEST } from '../shared/types'
import { createHash } from 'crypto'
import { baseMeta, domainOf, intensityOf, measurementsOf, parts, requireDoc, scoreFromJson, scoreToJson, summaryMetrics } from './defs-common'
import { detectText, resolveDetector } from './detector'
import { FIXTURES_INPUT as fixturesInput } from './data'
import { configError, finite, isRecord, toJson, toJsonObject } from './util'
import type { EvalContext, ScoredItem, TestDef, TrialMeta } from './suite'

/** The model and Humanite version are not known to the pack (the endpoint reports `modelUsed` per call). */
const MODEL = 'unspecified'
const PROVIDER = 'humanite'
const HUMANITE_VERSION = 'unspecified'

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex')

// ── A2H-07 ───────────────────────────────────────────────────────────────

function a2h07Input(ctx: EvalContext): A2H07TrialInput {
  const { meta } = ctx
  return {
    sourceId: meta.sourceId,
    sourceText: ctx.sourceText,
    domain: domainOf(meta),
    intensity: intensityOf(meta),
    conditionId: String(meta['conditionId']),
    trialIndex: finite(meta['repeat']) ?? 0,
    model: MODEL,
    modelProvider: PROVIDER,
    humaniteVersion: HUMANITE_VERSION,
  }
}

export const a2h07: TestDef = {
  code: 'A2H-07',
  category: 'experiments',
  description:
    'Repeatability: the exact same source, intensity and configuration is transformed several times; reports the variance of the AI probability and of the transformation magnitude, how often the classification agrees, and how many outputs are identical.',
  defaultEnabled: false,
  experimental: true,
  needsDetector: true,
  needsFixtures: false,
  timeoutMs: 600_000,
  defaultTrialCount: 30,
  design: (o) => ({ pool: 'corpus', cohort: 'A2H-07', cells: o.repeatability.intensities.length * o.repeatability.repeatCount }),
  buildSpec({ doc, cell }, o) {
    const source = requireDoc(doc)
    const { repeatCount, intensities } = o.repeatability
    const intensity = intensities[Math.floor(cell / repeatCount)] as number
    const repeat = cell % repeatCount
    const conditionId = repeatabilityConditionId(source.sourceId, intensity, MODEL, HUMANITE_VERSION)
    const input: A2H07TrialInput = {
      sourceId: source.sourceId, sourceText: source.text, domain: source.domain, intensity, conditionId, trialIndex: repeat,
      model: MODEL, modelProvider: PROVIDER, humaniteVersion: HUMANITE_VERSION,
    }
    return { calls: planA2H07Trial(input), meta: baseMeta('A2H-07', source, { intensity, repeat, conditionId }) }
  },
  async detect(ctx, services, batchId) {
    const detector = await resolveDetector(services)
    const post = await detectText(ctx.results[0]?.output ?? '', detector, ctx.runtime?.signal)
    return { post: scoreToJson({ ...post, runId: batchId }), detectorConfigId: detector.configId }
  },
  evaluate(ctx, detected) {
    const trial = measureA2H07Trial(a2h07Input(ctx), [...ctx.results], scoreFromJson(detected?.['post']))
    if (trial.status !== 'success') throw configError('The target produced no output')
    // The output text is already in the raw evidence; the stored measurement keeps its hash and word count.
    const { outputText: _text, ...compact } = trial
    void _text
    return Promise.resolve({
      passed: null,
      numeric: trial.aiProbability,
      unit: 'probability',
      eligible: true,
      measurement: toJsonObject(compact),
    })
  },
  aggregate(items) {
    const trials = measurementsOf<RepeatabilityTrial>(items)
    const report = buildA2H07Report(trials)
    return parts({
      numeric: report.meanClassificationAgreement,
      unit: 'ratio',
      direction: 'higher-is-better',
      metrics: {
        conditions: report.conditionsEvaluated,
        repeatsPerCondition: report.repeatsPerCondition,
        meanClassificationAgreement: report.meanClassificationAgreement,
        meanAiProbabilityCv: report.meanAiProbabilityCv,
        meanTransformationMagnitudeCv: report.meanTransformationMagnitudeCv,
        trials: trials.length,
      },
      report,
    })
  },
}

// ── A2H-11 and A2H-14 (paired contrasts) ──────────────────────────────────

type Directional = { movedExpectedDirection: boolean | null }

/**
 * The share of this pair's expected directions that held, pooled over its metrics (absent when the contrast
 * names none). Humanite reports per-metric shares; this single number is the pack's headline, not Humanite's.
 */
function pooledDirection(metrics: readonly Directional[]): number | null {
  const withDirection = metrics.filter((m) => m.movedExpectedDirection !== null)
  return withDirection.length === 0 ? null : withDirection.filter((m) => m.movedExpectedDirection === true).length / withDirection.length
}

function pooledOver(pairs: readonly Record<string, unknown>[], keys: readonly string[]): number | null {
  const all: Directional[] = []
  for (const pair of pairs) for (const k of keys) if (isRecord(pair[k])) all.push(pair[k] as unknown as Directional)
  return pooledDirection(all)
}

const TONE_KEYS = ['contractionRate', 'averageSentenceLength', 'hedgeDensity', 'firstPersonRate', 'readability'] as const
const GENRE_KEYS = ['readability', 'averageSentenceLength', 'lexicalComplexity', 'paragraphLength', 'firstPersonRate'] as const

function contrastFromMeta<T>(meta: TrialMeta): T {
  if (!isRecord(meta['contrast'])) throw configError('The trial carries no contrast')
  return meta['contrast'] as unknown as T
}

export const a2h11: TestDef = {
  code: 'A2H-11',
  category: 'experiments',
  description:
    'Style and tone control: the same source is transformed twice at a fixed intensity with two different tones; deterministic style metrics (contractions, sentence length, hedging, first person, readability) show whether the tone moved the text in the expected direction.',
  defaultEnabled: false,
  experimental: true,
  needsDetector: false,
  needsFixtures: false,
  timeoutMs: 1_200_000,
  defaultTrialCount: 30,
  design: (o) => ({ pool: 'corpus', cohort: 'A2H-11', cells: o.styleToneContrasts.length }),
  buildSpec({ doc, cell }, o) {
    const source = requireDoc(doc)
    const contrast = o.styleToneContrasts[cell] as StyleToneContrast
    return {
      calls: planA2H11Trial({ sourceId: source.sourceId, sourceText: source.text, domain: source.domain, contrast }),
      meta: baseMeta('A2H-11', source, { contrastId: contrast.id, contrast: toJson(contrast) }),
    }
  },
  evaluate(ctx) {
    const contrast = contrastFromMeta<StyleToneContrast>(ctx.meta)
    const pair = measureA2H11Trial({ sourceId: ctx.meta.sourceId, sourceText: ctx.sourceText, domain: domainOf(ctx.meta), contrast }, ctx.results)
    return Promise.resolve({
      passed: null,
      numeric: pooledDirection(TONE_KEYS.map((k) => pair[k])),
      unit: 'ratio',
      eligible: true,
      measurement: toJsonObject(pair),
    })
  },
  aggregate(items) {
    const pairs = measurementsOf<StyleTonePairMeasurements>(items)
    const contrasts = uniqueContrasts<StyleToneContrast>(items)
    const report = buildA2H11Report(pairs, contrasts)
    const pooled = pooledOver(pairs as unknown as Record<string, unknown>[], TONE_KEYS)
    return parts({
      numeric: pooled,
      unit: 'ratio',
      direction: 'higher-is-better',
      metrics: { pairs: pairs.length, contrasts: contrasts.length, expectedDirectionRate: pooled },
      report: { contrasts: report.contrasts, headline: 'expectedDirectionRate pools every metric with an expected direction over every pair (a pack summary, not a Humanite number)' },
    })
  },
}

function uniqueContrasts<T extends { id: string }>(items: readonly ScoredItem[]): T[] {
  const byId = new Map<string, T>()
  for (const item of items) {
    const c = item.meta['contrast']
    if (isRecord(c) && typeof c['id'] === 'string' && !byId.has(c['id'])) byId.set(c['id'], c as unknown as T)
  }
  return [...byId.values()]
}

export const a2h14: TestDef = {
  code: 'A2H-14',
  category: 'experiments',
  description:
    'Genre and audience control: the same source is transformed twice at a fixed intensity and tone with two different genres or audiences; deterministic metrics (readability, sentence length, lexical diversity, paragraph length, first person) show whether the setting moved the text in the expected direction.',
  defaultEnabled: false,
  experimental: true,
  needsDetector: false,
  needsFixtures: false,
  timeoutMs: 1_200_000,
  defaultTrialCount: 20,
  design: (o) => ({ pool: 'corpus', cohort: 'A2H-14', cells: o.genreAudienceContrasts.length }),
  buildSpec({ doc, cell }, o) {
    const source = requireDoc(doc)
    const contrast = o.genreAudienceContrasts[cell] as GenreAudienceContrast
    return {
      calls: planA2H14Trial({ sourceId: source.sourceId, sourceText: source.text, sourceDomain: source.domain, contrast }),
      meta: baseMeta('A2H-14', source, { contrastId: contrast.id, contrast: toJson(contrast) }),
    }
  },
  evaluate(ctx) {
    const contrast = contrastFromMeta<GenreAudienceContrast>(ctx.meta)
    const pair = measureA2H14Trial({ sourceId: ctx.meta.sourceId, sourceText: ctx.sourceText, sourceDomain: domainOf(ctx.meta), contrast }, ctx.results)
    return Promise.resolve({
      passed: null,
      numeric: pooledDirection(GENRE_KEYS.map((k) => pair[k])),
      unit: 'ratio',
      eligible: true,
      measurement: toJsonObject(pair),
    })
  },
  aggregate(items) {
    const pairs = measurementsOf<GenreAudiencePairMeasurements>(items)
    const contrasts = uniqueContrasts<GenreAudienceContrast>(items)
    const report = buildA2H14Report(pairs, contrasts)
    const pooled = pooledOver(pairs as unknown as Record<string, unknown>[], GENRE_KEYS)
    return parts({
      numeric: pooled,
      unit: 'ratio',
      direction: 'higher-is-better',
      metrics: { pairs: pairs.length, contrasts: contrasts.length, expectedDirectionRate: pooled },
      report: { contrasts: report.contrasts, headline: 'expectedDirectionRate pools every metric with an expected direction over every pair (a pack summary, not a Humanite number)' },
    })
  },
}

// ── A2H-15 ───────────────────────────────────────────────────────────────

const ARMS: readonly A2H15Arm[] = ['single', 'production']

function a2h15Input(ctx: EvalContext, arm: A2H15Arm): A2H15TrialInput {
  return {
    sourceId: ctx.meta.sourceId,
    sourceText: ctx.sourceText,
    domain: domainOf(ctx.meta),
    intensity: intensityOf(ctx.meta),
    arm,
    model: MODEL,
    modelProvider: PROVIDER,
  }
}

/** Telemetry the endpoint reported, if it has the shape Humanite's pipeline produced; null otherwise (never a guess). */
function selectionTelemetry(value: unknown): CandidateSelectionTelemetry | null {
  if (!isRecord(value)) return null
  const ran = value['ranCandidateSearch']
  const count = finite(value['candidateCount'])
  const dq = value['disqualifiedAt']
  if (typeof ran !== 'boolean' || count === undefined || !(dq === null || typeof dq === 'string')) return null
  return { ranCandidateSearch: ran, candidateCount: count, disqualifiedAt: dq }
}

export const a2h15: TestDef = {
  code: 'A2H-15',
  category: 'experiments',
  description:
    'Candidate selection: production multi-candidate search is compared with a single-candidate baseline under identical source, intensity, tone and domain; reports the difference in AI probability, transformation magnitude, grammar damage, latency, model calls and the preservation scores, only at intensities that actually run candidate search.',
  defaultEnabled: false,
  experimental: true,
  needsDetector: true,
  needsFixtures: false,
  timeoutMs: 1_200_000,
  defaultTrialCount: 20,
  design: (o) => ({ pool: 'corpus', cohort: 'A2H-15', cells: o.candidateSelectionIntensities.length }),
  buildSpec({ doc, cell }, o) {
    const source = requireDoc(doc)
    const intensity = o.candidateSelectionIntensities[cell] as number
    const calls = ARMS.flatMap((arm) =>
      planA2H15Trial({ sourceId: source.sourceId, sourceText: source.text, domain: source.domain, intensity, arm, model: MODEL, modelProvider: PROVIDER }),
    )
    return { calls, meta: baseMeta('A2H-15', source, { intensity }) }
  },
  async detect(ctx, services, batchId) {
    const detector = await resolveDetector(services)
    const scores = []
    for (const result of ctx.results) scores.push(scoreToJson({ ...(await detectText(result.output, detector, ctx.runtime?.signal)), runId: batchId }))
    return { arms: scores, detectorConfigId: detector.configId }
  },
  async evaluate(ctx, detected) {
    if (ctx.results.length !== 2) throw new FrameworkError('SCORING_ERROR', 'A2H-15 expects two call results (single, production)')
    const armScores = Array.isArray(detected?.['arms']) ? (detected['arms'] as unknown[]) : []
    // The trial results carry the extra telemetry only when the endpoint sent it in a recognised shape.
    const normalised: A2H15TargetResult[] = ctx.results.map((r) => {
      const telemetry = selectionTelemetry(r.candidateSelection)
      return { ...r, candidateSelection: telemetry }
    })
    const trials = ARMS.map((arm, i): A2H15Trial =>
      measureA2H15Trial(a2h15Input(ctx, arm), [normalised[i] as A2H15TargetResult], scoreFromJson(armScores[i])),
    )
    const [single, production] = trials as [A2H15Trial, A2H15Trial]
    const sourceFixtures = new Map<A2HTestCode, Awaited<ReturnType<EvalContext['fixturesOfType']>>>()
    if (ctx.runtime?.datasets?.has(fixturesInput) === true) {
      for (const code of A2H15_PRESERVATION_CODES) {
        const type = FIXTURE_TYPE_FOR_TEST[code]
        if (type !== undefined) {
          const found = await ctx.fixturesOfType(type)
          if (found.length > 0) sourceFixtures.set(code, found)
        }
      }
    }
    const pair = computeCandidateSelectionPairMeasurements(ctx.meta.sourceId, intensityOf(ctx.meta), single, production, {
      grammarDamage: (text) => {
        const m = evaluateGrammarDamage(ctx.sourceText, text).measurements
        return { eligible: m.eligible, newErrorsPer1000: m.newErrorsPer1000 }
      },
      ...(sourceFixtures.size === 0
        ? {}
        : {
            preservationScores: (text: string) => {
              const scores: Partial<Record<A2HTestCode, number | null>> = {}
              for (const [code, fixtures] of sourceFixtures) {
                const evaluator = DETERMINISTIC_EVALUATORS[code]
                if (evaluator !== undefined) scores[code] = evaluator([...fixtures], text).score
              }
              return scores
            },
          }),
    })
    return {
      passed: null,
      numeric: pair.aiProbability.delta,
      unit: 'probability-delta',
      eligible: true,
      measurement: toJsonObject({ ...pair, arms: { single: sha256(single.outputText ?? ''), production: sha256(production.outputText ?? '') } }),
    }
  },
  aggregate(items) {
    const pairs = measurementsOf<CandidateSelectionPairMeasurements>(items)
    const a = aggregateA2H15(pairs)
    return parts({
      numeric: a.aiProbabilityDelta.mean,
      unit: 'probability-delta',
      direction: 'lower-is-better',
      metrics: {
        pairs: a.n,
        ...summaryMetrics('aiProbabilityDelta', a.aiProbabilityDelta),
        ...summaryMetrics('transformationMagnitudeDelta', a.transformationMagnitudeDelta),
        ...summaryMetrics('grammarDamageDelta', a.grammarDamageDelta),
        ...summaryMetrics('latencyDeltaMs', a.latencyDeltaMs),
        ...summaryMetrics('modelCallsDelta', a.modelCallsDelta),
        candidateRejectionRate: a.candidateRejectionRate,
        allDisqualifiedRate: a.allDisqualifiedRate,
      },
      report: a,
    })
  },
}

import type { Firestore } from 'firebase-admin/firestore'
import type OpenAI from 'openai'
import { createHash } from 'crypto'
import { runHumaniteDocument } from '@/lib/runHumaniteDocument'
import { effectiveIntensity } from '@/lib/intensity'
import { measureStyleDiagnostics } from '@/lib/style/measure'
import { toValidTone } from '@/lib/style/types'
import type { BenchmarkRun, BenchmarkJob, CorpusSource, BenchmarkTrial, StyleToneContrast } from './types'
import { getOrCreateTrial, listTrialsForRun, type TrialRunResult } from './trials'
import { groupBy } from './statistics'
import { metricDelta, aggregateMetric, type StyleToneMetricDelta, type StyleToneMetricAggregate } from './styleContrastShared'

export const A2H11_CODE = 'A2H-11' as const
// Held constant across both arms of every contrast, at a mid-level intensity
// — Phase 3's own acceptance criterion for the style compiler held domain
// constant "to isolate the tone axis"; this holds intensity constant for the
// same reason.
const FIXED_INTENSITY = 5

function leftConditionId(contrastId: string): string { return `${contrastId}__left` }
function rightConditionId(contrastId: string): string { return `${contrastId}__right` }

// Real, currently-supported Tone values only (style/types.ts's TONES) — the
// three contrasts the spec itself names as examples.
export const INITIAL_STYLE_TONE_CONTRASTS: StyleToneContrast[] = [
  {
    id: 'academic-vs-casual',
    label: 'Academic → Casual',
    left: { tone: 'academic' },
    right: { tone: 'casual' },
    expectedDirections: {
      contractionRate: 'higher_right',
      averageSentenceLength: 'higher_left',
      hedgeDensity: 'higher_left',
      readability: 'higher_right',
    },
  },
  {
    id: 'formal-vs-casual',
    label: 'Formal → Casual',
    left: { tone: 'formal' },
    right: { tone: 'casual' },
    expectedDirections: {
      contractionRate: 'higher_right',
      averageSentenceLength: 'higher_left',
      hedgeDensity: 'higher_left',
      readability: 'higher_right',
    },
  },
  {
    id: 'balanced-vs-academic',
    label: 'Balanced → Academic',
    left: { tone: 'balanced' },
    right: { tone: 'academic' },
    expectedDirections: {
      contractionRate: 'higher_left',
      averageSentenceLength: 'higher_right',
      hedgeDensity: 'higher_right',
      readability: 'higher_left',
    },
  },
]

export interface StyleToneCondition {
  sourceId: string
  contrastId: string
  side: 'left' | 'right'
  conditionId: string
}

export function generateA2H11Conditions(sourceIds: string[], contrasts: StyleToneContrast[]): StyleToneCondition[] {
  const conditions: StyleToneCondition[] = []
  for (const sourceId of sourceIds) {
    for (const contrast of contrasts) {
      conditions.push({ sourceId, contrastId: contrast.id, side: 'left', conditionId: leftConditionId(contrast.id) })
      conditions.push({ sourceId, contrastId: contrast.id, side: 'right', conditionId: rightConditionId(contrast.id) })
    }
  }
  return conditions
}

export interface RunA2H11TrialOptions {
  client: OpenAI
  model: string
  modelProvider: string
}

export async function runA2H11Trial(firestore: Firestore, run: BenchmarkRun, source: CorpusSource, job: BenchmarkJob, options: RunA2H11TrialOptions): Promise<void> {
  if (!job.conditionId) throw new Error(`A2H-11 trial job ${job.id} is missing conditionId.`)
  const contrasts = run.experimentConfig?.styleTone?.contrasts ?? []
  const isLeft = job.conditionId.endsWith('__left')
  const contrastId = job.conditionId.replace(/__(left|right)$/, '')
  const contrast = contrasts.find(c => c.id === contrastId)
  if (!contrast) throw new Error(`A2H-11 trial job ${job.id} references unknown contrast ${contrastId}.`)
  const tone = toValidTone(isLeft ? contrast.left.tone : contrast.right.tone)
  const effective = effectiveIntensity(FIXED_INTENSITY, source.domainId)

  await getOrCreateTrial(firestore, {
    runId: run.id,
    corpusProjectId: run.corpusProjectId,
    benchmarkCode: A2H11_CODE,
    sourceId: source.id,
    conditionId: job.conditionId,
    trialIndex: 0,
    condition: {
      sourceId: source.id, contrastId, side: isLeft ? 'left' : 'right', tone, intensity: FIXED_INTENSITY,
      requestedIntensity: effective.requested, appliedIntensity: effective.applied, intensityCapped: effective.capped,
    },
    run: async (): Promise<TrialRunResult> => {
      const start = Date.now()
      try {
        const generated = await runHumaniteDocument({
          client: options.client, model: options.model, sourceText: source.text, requestedIntensity: FIXED_INTENSITY,
          tone, domain: source.domainId,
        })
        return {
          outputText: generated.text,
          outputSha256: createHash('sha256').update(generated.text).digest('hex'),
          outputWords: generated.text.trim() ? generated.text.trim().split(/\s+/).length : 0,
          modelProvider: options.modelProvider,
          model: generated.modelUsed,
          latencyMs: Date.now() - start,
          modelCalls: generated.modelCalls,
          retryCount: generated.retryCount,
          candidateCount: generated.candidateCount,
          inputTokens: generated.inputTokens,
          outputTokens: generated.outputTokens,
          estimatedCostUsd: null,
          aiProbability: null,
          humanProbability: null,
          classification: null,
          diagnostics: null,
          status: 'success',
          errorCode: null,
          errorMessage: null,
        }
      } catch (err) {
        return {
          outputText: null, outputSha256: null, outputWords: null, modelProvider: options.modelProvider, model: options.model,
          latencyMs: Date.now() - start, modelCalls: null, retryCount: 0, candidateCount: null, inputTokens: null, outputTokens: null,
          estimatedCostUsd: null, aiProbability: null, humanProbability: null, classification: null, diagnostics: null,
          status: 'failed', errorCode: err instanceof Error ? err.constructor.name : 'UnknownError',
          errorMessage: err instanceof Error ? err.message : 'Style/tone trial failed.',
        }
      }
    },
  })
}

// ── Measurement / aggregation (§10-12) ────────────────────────────────────

export interface StyleTonePairMeasurements {
  sourceId: string
  contrastId: string
  contractionRate: StyleToneMetricDelta
  averageSentenceLength: StyleToneMetricDelta
  hedgeDensity: StyleToneMetricDelta
  firstPersonRate: StyleToneMetricDelta
  readability: StyleToneMetricDelta
}

// Pure: computes one contrast pair's deterministic metric deltas directly
// from left/right text — no LLM judgment of "sounds casual," per §10's own
// explicit constraint.
export function computeStyleTonePairMeasurements(sourceId: string, contrastId: string, leftText: string, rightText: string, contrast: StyleToneContrast): StyleTonePairMeasurements {
  const left = measureStyleDiagnostics(leftText)
  const right = measureStyleDiagnostics(rightText)
  return {
    sourceId,
    contrastId,
    contractionRate: metricDelta(left.contraction_rate, right.contraction_rate, contrast.expectedDirections.contractionRate),
    averageSentenceLength: metricDelta(left.average_sentence_length, right.average_sentence_length, contrast.expectedDirections.averageSentenceLength),
    hedgeDensity: metricDelta(left.hedge_density, right.hedge_density, contrast.expectedDirections.hedgeDensity),
    firstPersonRate: metricDelta(left.first_person_rate, right.first_person_rate, contrast.expectedDirections.firstPersonRate),
    readability: metricDelta(left.readability_score, right.readability_score, contrast.expectedDirections.readability),
  }
}

export interface StyleToneContrastAggregate {
  contrastId: string
  label: string
  n: number
  contractionRate: StyleToneMetricAggregate
  averageSentenceLength: StyleToneMetricAggregate
  hedgeDensity: StyleToneMetricAggregate
  firstPersonRate: StyleToneMetricAggregate
  readability: StyleToneMetricAggregate
}

export function aggregateStyleToneContrast(pairs: StyleTonePairMeasurements[], contrast: StyleToneContrast): StyleToneContrastAggregate {
  return {
    contrastId: contrast.id,
    label: contrast.label,
    n: pairs.length,
    contractionRate: aggregateMetric(pairs.map(p => p.contractionRate)),
    averageSentenceLength: aggregateMetric(pairs.map(p => p.averageSentenceLength)),
    hedgeDensity: aggregateMetric(pairs.map(p => p.hedgeDensity)),
    firstPersonRate: aggregateMetric(pairs.map(p => p.firstPersonRate)),
    readability: aggregateMetric(pairs.map(p => p.readability)),
  }
}

export interface A2H11Report {
  contrasts: StyleToneContrastAggregate[]
  pairs: StyleTonePairMeasurements[]
}

// Reads every A2H-11 trial for the run, pairs left/right trials that share a
// (sourceId, contrastId) and both completed successfully, and computes
// deltas — a pair with only one side complete (or still queued) is simply
// not reported yet, never fabricated from a missing side.
export async function getA2H11Report(firestore: Firestore, runId: string, contrasts: StyleToneContrast[]): Promise<A2H11Report> {
  const trials = await listTrialsForRun(firestore, runId, A2H11_CODE)
  const successful = trials.filter(t => t.status === 'success' && t.outputText != null)
  const byPair = groupBy(successful, t => `${t.sourceId}__${t.condition['contrastId'] as string}`)

  const pairs: StyleTonePairMeasurements[] = []
  for (const [, group] of byPair) {
    const left = group.find(t => t.condition['side'] === 'left')
    const right = group.find(t => t.condition['side'] === 'right')
    if (!left || !right) continue
    const contrastId = left.condition['contrastId'] as string
    const contrast = contrasts.find(c => c.id === contrastId)
    if (!contrast) continue
    pairs.push(computeStyleTonePairMeasurements(left.sourceId, contrastId, left.outputText!, right.outputText!, contrast))
  }

  const contrastAggregates = contrasts.map(contrast => aggregateStyleToneContrast(pairs.filter(p => p.contrastId === contrast.id), contrast))
  return { contrasts: contrastAggregates, pairs }
}

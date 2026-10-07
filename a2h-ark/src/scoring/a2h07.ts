import { createHash } from 'crypto'
import type { DetectionClassification } from '../vendor/detection/contracts'
import type { Domain } from '../vendor/style/types'
import { preprocess } from '../vendor/preprocess'
import { effectiveIntensity } from '../vendor/intensity'
import { measureIntensity } from '../vendor/evaluation/intensity'
import type { TargetCall, TargetCallResult } from '../shared/targetCalls'
import type { BenchmarkTrial } from '../shared/types'
import { summarizeContinuous, coefficientOfVariation, groupBy, type ContinuousSummary } from '../shared/statistics'
import { planHumanizeCall, sha256Hex, wordCount, type DetectorScore } from './trialCommon'

export const A2H07_CODE = 'A2H-07' as const

// A2H-07 — Repeatability. Measures variance when the EXACT SAME
// source + intensity + Humanite configuration is executed repeatedly — every
// repeat holds source, model, provider, Humanite version, domain, tone, and
// intensity constant; only ordinary stochastic model behavior varies.

// Stable hash of everything a repeat condition holds constant — deliberately
// NOT including trialIndex, so every repeat of the same condition shares one conditionId.
export function repeatabilityConditionId(sourceId: string, intensity: number, model: string, humaniteVersion: string): string {
  const payload = JSON.stringify({ sourceId, intensity, model, humaniteVersion })
  return createHash('sha256').update(payload).digest('hex').slice(0, 24)
}

export interface RepeatabilityCondition {
  sourceId: string
  intensity: number
  conditionId: string
  trialIndex: number
}

// Enumerates every (source, intensity, repeat) trial this test needs for a given cohort.
export function generateA2H07Conditions(sourceIds: string[], intensities: number[], repeatCount: number, model: string, humaniteVersion: string): RepeatabilityCondition[] {
  const conditions: RepeatabilityCondition[] = []
  for (const sourceId of sourceIds) {
    for (const intensity of intensities) {
      const conditionId = repeatabilityConditionId(sourceId, intensity, model, humaniteVersion)
      for (let trialIndex = 0; trialIndex < repeatCount; trialIndex++) {
        conditions.push({ sourceId, intensity, conditionId, trialIndex })
      }
    }
  }
  return conditions
}

// ── Plan / measure halves (Humanite's runA2H07Trial) ──────────────────────

export interface A2H07TrialInput {
  sourceId: string
  sourceText: string
  domain: Domain
  /** The REQUESTED intensity (1-10). */
  intensity: number
  conditionId: string
  trialIndex: number
  /** The model the run is configured for (recorded when the trial fails before a model is known). */
  model: string
  modelProvider: string
  humaniteVersion: string
}

// One repeat = one ordinary Humanize call (fixed tone, requested intensity, the source's domain).
export function planA2H07Trial(input: A2H07TrialInput): TargetCall[] {
  return [planHumanizeCall(input.sourceText, input.intensity, input.domain)]
}

// The fields of Humanite's BenchmarkTrial that A2H-07's measurement reads or records; a full
// BenchmarkTrial is structurally assignable.
export type RepeatabilityTrial = Pick<BenchmarkTrial, 'sourceId' | 'conditionId' | 'trialIndex' | 'condition' | 'status' | 'aiProbability' | 'classification' | 'outputSha256' | 'diagnostics'>

export interface A2H07TrialMeasurement extends RepeatabilityTrial {
  benchmarkCode: typeof A2H07_CODE
  outputText: string | null
  outputWords: number | null
  modelProvider: string
  model: string
  latencyMs: number | null
  modelCalls: number | null
  retryCount: number
  candidateCount: number | null
  inputTokens: number | null
  outputTokens: number | null
  estimatedCostUsd: number | null
  humanProbability: number | null
  errorCode: string | null
  errorMessage: string | null
}

export interface A2H07Failure { errorCode: string; errorMessage: string }

// `detector` is the GPTZero score of the target's output text (never called here). A trial is
// 'failed' (every measurement null, model = the configured one) when the target errored
// (`failure`) or returned no call result; the recorded condition carries requested vs applied
// intensity from the pure domain-cap function, exactly as Humanite froze it.
export function measureA2H07Trial(input: A2H07TrialInput, results: TargetCallResult[], detector: DetectorScore | null, failure?: A2H07Failure): A2H07TrialMeasurement {
  const effective = effectiveIntensity(input.intensity, input.domain)
  const base = {
    benchmarkCode: A2H07_CODE,
    sourceId: input.sourceId,
    conditionId: input.conditionId,
    trialIndex: input.trialIndex,
    condition: {
      sourceId: input.sourceId, intensity: input.intensity, model: input.model, humaniteVersion: input.humaniteVersion,
      requestedIntensity: effective.requested, appliedIntensity: effective.applied, intensityCapped: effective.capped,
    } as Record<string, unknown>,
    modelProvider: input.modelProvider,
    estimatedCostUsd: null,
  } as const
  const result = results[0]
  if (failure || !result) {
    return {
      ...base, outputText: null, outputSha256: null, outputWords: null, model: input.model,
      latencyMs: result?.latencyMs ?? null, modelCalls: null, retryCount: 0, candidateCount: null, inputTokens: null, outputTokens: null,
      aiProbability: null, humanProbability: null, classification: null, diagnostics: null,
      status: 'failed', errorCode: failure?.errorCode ?? 'UnknownError', errorMessage: failure?.errorMessage ?? 'Repeatability trial failed.',
    }
  }
  const factLockTexts = preprocess(input.sourceText).fact_locks.map(l => l.text)
  return {
    ...base,
    outputText: result.output,
    outputSha256: sha256Hex(result.output),
    outputWords: wordCount(result.output),
    model: result.modelUsed ?? input.model,
    latencyMs: result.latencyMs,
    modelCalls: result.modelCalls,
    retryCount: result.retryCount,
    candidateCount: result.candidateCount ?? null,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    aiProbability: detector?.aiProbability ?? null,
    humanProbability: detector?.humanProbability ?? null,
    classification: detector?.classification ?? null,
    diagnostics: { transformationMagnitude: measureIntensity(input.sourceText, result.output, factLockTexts).transformationMagnitude },
    status: 'success',
    errorCode: null,
    errorMessage: null,
  }
}

// ── Measurement / aggregation ─────────────────────────────────────────────

export interface RepeatabilityConditionMeasurements {
  conditionId: string
  sourceId: string
  intensity: number
  n: number
  aiProbability: ContinuousSummary
  aiProbabilityCv: number | null
  transformationMagnitude: ContinuousSummary
  transformationMagnitudeCv: number | null
  classificationAgreement: number | null
  aiClassificationAgreement: number | null
  uniqueOutputCount: number
  identicalOutputCount: number
  trials: Array<{ trialIndex: number; aiProbability: number | null; classification: DetectionClassification | null; transformationMagnitude: number | null; outputSha256: string | null }>
}

// The most frequent value's share of n — 1.0 means every repeat agreed.
function modalAgreement<T>(values: T[]): number | null {
  if (values.length === 0) return null
  const counts = new Map<T, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  const maxCount = Math.max(...counts.values())
  return maxCount / values.length
}

export function aggregateRepeatabilityCondition(trials: RepeatabilityTrial[]): RepeatabilityConditionMeasurements {
  const successful = trials.filter(t => t.status === 'success')
  const sorted = [...successful].sort((a, b) => a.trialIndex - b.trialIndex)
  const aiProbabilities = sorted.map(t => t.aiProbability).filter((v): v is number => v != null)
  const classifications = sorted.map(t => t.classification).filter((v): v is DetectionClassification => v != null)
  const magnitudes = sorted.map(t => (t.diagnostics?.['transformationMagnitude'] as number | undefined) ?? null).filter((v): v is number => v != null)
  const hashes = sorted.map(t => t.outputSha256).filter((v): v is string => v != null)
  const uniqueOutputCount = new Set(hashes).size

  // "AI classification agreement" is deliberately the SAME modal-agreement
  // computation as "human-classification agreement" — a repeat's
  // classification is a single DetectionClassification value, not two
  // separate axes, so both names resolve to one measurement here.
  return {
    conditionId: sorted[0]?.conditionId ?? '',
    sourceId: sorted[0]?.sourceId ?? '',
    intensity: (sorted[0]?.condition['intensity'] as number | undefined) ?? 0,
    n: sorted.length,
    aiProbability: summarizeContinuous(aiProbabilities),
    aiProbabilityCv: aiProbabilities.length > 0 ? coefficientOfVariation(aiProbabilities) : null,
    transformationMagnitude: summarizeContinuous(magnitudes),
    transformationMagnitudeCv: magnitudes.length > 0 ? coefficientOfVariation(magnitudes) : null,
    classificationAgreement: modalAgreement(classifications),
    aiClassificationAgreement: modalAgreement(classifications),
    uniqueOutputCount,
    identicalOutputCount: hashes.length - uniqueOutputCount,
    trials: sorted.map(t => ({
      trialIndex: t.trialIndex,
      aiProbability: t.aiProbability,
      classification: t.classification,
      transformationMagnitude: (t.diagnostics?.['transformationMagnitude'] as number | undefined) ?? null,
      outputSha256: t.outputSha256,
    })),
  }
}

export interface A2H07Report {
  conditionsEvaluated: number
  repeatsPerCondition: number | null
  meanAiProbabilityCv: number | null
  meanTransformationMagnitudeCv: number | null
  meanClassificationAgreement: number | null
  conditions: RepeatabilityConditionMeasurements[]
}

function meanOf(values: Array<number | null>): number | null {
  const present = values.filter((v): v is number => v != null)
  return present.length === 0 ? null : present.reduce((a, b) => a + b, 0) / present.length
}

// The pure half of Humanite's getA2H07Report (all of a run's A2H-07 trials in, report out).
export function buildA2H07Report(trials: RepeatabilityTrial[]): A2H07Report {
  const byCondition = groupBy(trials, t => `${t.sourceId}__${t.conditionId}`)
  const conditions = [...byCondition.values()].map(aggregateRepeatabilityCondition).sort((a, b) => a.sourceId.localeCompare(b.sourceId) || a.intensity - b.intensity)

  return {
    conditionsEvaluated: conditions.length,
    repeatsPerCondition: conditions.length > 0 ? Math.max(...conditions.map(c => c.n)) : null,
    meanAiProbabilityCv: meanOf(conditions.map(c => c.aiProbabilityCv)),
    meanTransformationMagnitudeCv: meanOf(conditions.map(c => c.transformationMagnitudeCv)),
    meanClassificationAgreement: meanOf(conditions.map(c => c.classificationAgreement)),
    conditions,
  }
}

// ── Work-estimate helper ──────────────────────────────────────────────────

export interface RepeatabilityWorkEstimate {
  sourcesSelected: number
  intensitiesSelected: number
  repeats: number
  humaniteTrialOutputs: number
  gptZeroPostAnalyses: number
}

export function estimateRepeatabilityWork(sourceCount: number, intensityCount: number, repeatCount: number): RepeatabilityWorkEstimate {
  const trials = sourceCount * intensityCount * repeatCount
  return { sourcesSelected: sourceCount, intensitiesSelected: intensityCount, repeats: repeatCount, humaniteTrialOutputs: trials, gptZeroPostAnalyses: trials }
}

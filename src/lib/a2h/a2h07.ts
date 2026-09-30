import type { Firestore } from 'firebase-admin/firestore'
import type OpenAI from 'openai'
import { createHash } from 'crypto'
import { preprocess } from '@/lib/preprocess'
import { runHumaniteDocument } from '@/lib/runHumaniteDocument'
import { effectiveIntensity } from '@/lib/intensity'
import { measureIntensity } from '@/lib/evaluation/intensity'
import type { DetectionClassification } from '@/lib/detection/contracts'
import type { BenchmarkRun, BenchmarkJob, CorpusSource, BenchmarkTrial } from './types'
import { getOrCreateTrial, listTrialsForRun, type TrialRunResult } from './trials'
import { scoreTextWithGPTZero } from './baseline'
import { summarizeContinuous, coefficientOfVariation, groupBy, type ContinuousSummary } from './statistics'

export const A2H07_CODE = 'A2H-07' as const
const FIXED_TONE = 'balanced'

// A2H-07 — Repeatability (§3-7). Measures variance when the EXACT SAME
// source + intensity + Humanite configuration is executed repeatedly — every
// repeat holds source, model, provider, Humanite version, git commit,
// domain, tone, and intensity constant (all already run-level constants);
// only ordinary stochastic model behavior varies between repeats.

function wordCount(text: string): number {
  const trimmed = text.trim()
  return trimmed ? trimmed.split(/\s+/).length : 0
}

// Stable hash of everything a repeat condition holds constant — deliberately
// NOT including trialIndex, so every repeat of the same condition shares one
// conditionId (see trials.ts's trialId(), which appends trialIndex itself).
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

// Enumerates every (source, intensity, repeat) trial this test needs for a
// given cohort — pure and side-effect free, so idempotent enqueueing (§37)
// and unit tests can both call it directly.
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

export interface RunA2H07TrialOptions {
  client: OpenAI
  model: string
  modelProvider: string
  gptZeroApiKey: string
}

// Runs ONE repeat of the ordinary Humanize pipeline (the same
// preprocess -> humanizeChunk call shape outputs.ts's transformSource uses,
// at the FIXED_TONE every A2H-01/02/03 baseline also holds constant) plus a
// fresh GPTZero call, persisted via getOrCreateTrial's idempotency guard —
// a resumed run never re-pays for a completed repeat.
export async function runA2H07Trial(firestore: Firestore, run: BenchmarkRun, source: CorpusSource, job: BenchmarkJob, options: RunA2H07TrialOptions): Promise<void> {
  if (job.intensity == null || !job.conditionId || job.trialIndex == null) {
    throw new Error(`A2H-07 trial job ${job.id} is missing intensity/conditionId/trialIndex.`)
  }
  const intensity = job.intensity
  // Pure/deterministic — computed once here (not inside `run`) so the
  // frozen `condition` itself records what was requested vs. what
  // production's domain cap would actually apply, even before the trial's
  // async generation runs at all (§2/§23 of the "Final Polish" patch).
  const effective = effectiveIntensity(intensity, source.domainId)

  await getOrCreateTrial(firestore, {
    runId: run.id,
    corpusProjectId: run.corpusProjectId,
    benchmarkCode: A2H07_CODE,
    sourceId: source.id,
    conditionId: job.conditionId,
    trialIndex: job.trialIndex,
    condition: {
      sourceId: source.id, intensity, model: options.model, humaniteVersion: run.humaniteVersion,
      requestedIntensity: effective.requested, appliedIntensity: effective.applied, intensityCapped: effective.capped,
    },
    run: async (): Promise<TrialRunResult> => {
      const start = Date.now()
      try {
        const generated = await runHumaniteDocument({
          client: options.client, model: options.model, sourceText: source.text, requestedIntensity: intensity,
          tone: FIXED_TONE, domain: source.domainId,
        })
        const latencyMs = Date.now() - start
        const detector = await scoreTextWithGPTZero(generated.text, options.gptZeroApiKey)
        const factLockTexts = preprocess(source.text).fact_locks.map(l => l.text)
        return {
          outputText: generated.text,
          outputSha256: createHash('sha256').update(generated.text).digest('hex'),
          outputWords: wordCount(generated.text),
          modelProvider: options.modelProvider,
          model: generated.modelUsed,
          latencyMs,
          modelCalls: generated.modelCalls,
          retryCount: generated.retryCount,
          candidateCount: generated.candidateCount,
          inputTokens: generated.inputTokens,
          outputTokens: generated.outputTokens,
          estimatedCostUsd: null,
          aiProbability: detector.aiProbability,
          humanProbability: detector.humanProbability,
          classification: detector.classification,
          diagnostics: { transformationMagnitude: measureIntensity(source.text, generated.text, factLockTexts).transformationMagnitude },
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
          errorMessage: err instanceof Error ? err.message : 'Repeatability trial failed.',
        }
      }
    },
  })
}

// ── Measurement / aggregation (§6-7) ──────────────────────────────────────

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

export function aggregateRepeatabilityCondition(trials: BenchmarkTrial[]): RepeatabilityConditionMeasurements {
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
  // separate axes, so both names in §6 resolve to one measurement here.
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

export async function getA2H07Report(firestore: Firestore, runId: string): Promise<A2H07Report> {
  const trials = await listTrialsForRun(firestore, runId, A2H07_CODE)
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

// ── Work-estimate helper (§4, §39) ────────────────────────────────────────

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

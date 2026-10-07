// Ported from humanite2 src/lib/a2h/a2h11.ts @ 141e366. The pure scoring core of A2H-11 (Style/Tone Control).
// Humanite's trial runner (Firestore, jobs, `runHumaniteDocument`) is not ported: the two product calls it made
// per contrast are described by `planA2H11Trial` and their answers are scored by `measureA2H11Trial`.
import { effectiveIntensity } from '../vendor/intensity/effectiveIntensity'
import { measureStyleDiagnostics } from '../vendor/style/measure'
import { toValidTone, TONES, type Domain } from '../vendor/style/types'
import type { StyleToneContrast } from '../shared/types'
import { metricDelta, aggregateMetric, type StyleToneMetricDelta, type StyleToneMetricAggregate } from '../shared/styleContrastShared'
import type { TargetCall, TargetCallResult } from '../shared/targetCalls'

export const A2H11_CODE = 'A2H-11' as const
// Held constant across both arms of every contrast, at a mid-level intensity
// — Phase 3's own acceptance criterion for the style compiler held domain
// constant "to isolate the tone axis"; this holds intensity constant for the
// same reason.
export const A2H11_FIXED_INTENSITY = 5

export function leftConditionId(contrastId: string): string { return `${contrastId}__left` }
export function rightConditionId(contrastId: string): string { return `${contrastId}__right` }

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

// ── Contrast configuration validation ─────────────────────────────────────

const DIRECTIONS = ['higher_left', 'higher_right'] as const
const EXPECTED_DIRECTION_KEYS = ['contractionRate', 'averageSentenceLength', 'hedgeDensity', 'firstPersonRate', 'readability'] as const

// Validates a (possibly user-supplied) contrast list: every side must name a real, supported Tone (this
// module never invents a tone the product cannot invoke), ids must be unique and non-empty, and every
// expected direction must be a known metric with a known direction.
export function validateStyleToneContrasts(value: unknown): { contrasts: StyleToneContrast[] } | { error: string } {
  if (!Array.isArray(value) || value.length === 0) return { error: 'contrasts must be a non-empty array.' }
  const seen = new Set<string>()
  const out: StyleToneContrast[] = []
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) return { error: 'Every contrast must be an object.' }
    const c = raw as Record<string, unknown>
    const id = typeof c['id'] === 'string' ? c['id'].trim() : ''
    if (!id) return { error: 'Every contrast needs an id.' }
    if (/__(left|right)$/.test(id)) return { error: `Contrast id "${id}" must not end in __left or __right.` }
    if (seen.has(id)) return { error: `Duplicate contrast id "${id}".` }
    seen.add(id)
    const label = typeof c['label'] === 'string' && c['label'].trim() ? c['label'].trim() : id
    const sides: { tone: string }[] = []
    for (const key of ['left', 'right'] as const) {
      const side = c[key] as Record<string, unknown> | undefined
      const tone = side && typeof side['tone'] === 'string' ? side['tone'] : ''
      if (!(TONES as readonly string[]).includes(tone)) return { error: `Contrast "${id}" ${key}.tone must be one of: ${TONES.join(', ')}.` }
      sides.push({ tone })
    }
    const expectedDirections: StyleToneContrast['expectedDirections'] = {}
    const rawDirs = c['expectedDirections']
    if (rawDirs !== undefined) {
      if (typeof rawDirs !== 'object' || rawDirs === null) return { error: `Contrast "${id}" expectedDirections must be an object.` }
      for (const [k, v] of Object.entries(rawDirs as Record<string, unknown>)) {
        if (!(EXPECTED_DIRECTION_KEYS as readonly string[]).includes(k)) return { error: `Contrast "${id}" has unknown expected-direction metric "${k}".` }
        if (!(DIRECTIONS as readonly unknown[]).includes(v)) return { error: `Contrast "${id}" ${k} must be higher_left or higher_right.` }
        expectedDirections[k as typeof EXPECTED_DIRECTION_KEYS[number]] = v as 'higher_left' | 'higher_right'
      }
    }
    out.push({ id, label, left: sides[0]!, right: sides[1]!, expectedDirections })
  }
  return { contrasts: out }
}

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

// ── Trial plan (replaces the two runHumaniteDocument calls of runA2H11Trial) ──

export interface A2H11TrialInput {
  sourceId: string
  sourceText: string
  /** The source's own domain: held constant across both arms. */
  domain: Domain
  contrast: StyleToneContrast
}

// Exactly two 'humanize' calls, [left, right]: same source text, same domain, intensity fixed at 5; only the
// tone differs (via toValidTone, as the original). No genre or audience is set.
export function planA2H11Trial(input: A2H11TrialInput): TargetCall[] {
  const { contrast } = input
  const call = (tone: string): TargetCall => ({
    operation: 'humanize',
    text: input.sourceText,
    settings: { intensity: A2H11_FIXED_INTENSITY, tone: toValidTone(tone), domain: input.domain },
  })
  return [call(contrast.left.tone), call(contrast.right.tone)]
}

// What the original recorded as each trial's `condition` (intensity requested vs applied after the domain cap).
export function a2h11TrialCondition(input: A2H11TrialInput, side: 'left' | 'right') {
  const effective = effectiveIntensity(A2H11_FIXED_INTENSITY, input.domain)
  return {
    sourceId: input.sourceId,
    contrastId: input.contrast.id,
    side,
    tone: toValidTone(side === 'left' ? input.contrast.left.tone : input.contrast.right.tone),
    intensity: A2H11_FIXED_INTENSITY,
    requestedIntensity: effective.requested,
    appliedIntensity: effective.applied,
    intensityCapped: effective.capped,
  }
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

// Scores one trial from the target's answers to `planA2H11Trial` ([left, right], in plan order). A missing or
// failed side is the caller's concern (Humanite never reported a pair with only one side complete).
export function measureA2H11Trial(input: A2H11TrialInput, results: readonly TargetCallResult[]): StyleTonePairMeasurements {
  if (results.length !== 2) throw new Error(`A2H-11 trial expects 2 call results (left, right), got ${results.length}.`)
  return computeStyleTonePairMeasurements(input.sourceId, input.contrast.id, results[0]!.output, results[1]!.output, input.contrast)
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

// Pure equivalent of getA2H11Report's final step: aggregates already-measured pairs per contrast.
export function buildA2H11Report(pairs: StyleTonePairMeasurements[], contrasts: StyleToneContrast[]): A2H11Report {
  const contrastAggregates = contrasts.map(contrast => aggregateStyleToneContrast(pairs.filter(p => p.contrastId === contrast.id), contrast))
  return { contrasts: contrastAggregates, pairs }
}

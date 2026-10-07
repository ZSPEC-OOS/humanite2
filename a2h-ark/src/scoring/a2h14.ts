// Ported from humanite2 src/lib/a2h/a2h14.ts @ 141e366. The pure scoring core of A2H-14 (Genre/Audience).
// Humanite's trial runner (Firestore, jobs, `runHumaniteDocument`) is not ported: the two product calls it made
// per contrast are described by `planA2H14Trial` and their answers are scored by `measureA2H14Trial`.
import { effectiveIntensity } from '../vendor/intensity/effectiveIntensity'
import { calculateLocalDiagnostics } from '../vendor/detection/diagnostics'
import { toValidGenre, toValidAudience, DOMAINS, GENRES, AUDIENCES, type Domain, type Genre, type Audience } from '../vendor/style/types'
import type { GenreAudienceContrast } from '../shared/types'
import { metricDelta, aggregateMetric, type StyleToneMetricDelta, type StyleToneMetricAggregate } from '../shared/styleContrastShared'
import type { TargetCall, TargetCallResult } from '../shared/targetCalls'

export const A2H14_CODE = 'A2H-14' as const
export const A2H14_FIXED_TONE = 'balanced'
export const A2H14_FIXED_INTENSITY = 5

export function leftConditionId(contrastId: string): string { return `${contrastId}__left` }
export function rightConditionId(contrastId: string): string { return `${contrastId}__right` }

// Real, currently-supported Genre/Audience values only (style/types.ts's
// GENRES/AUDIENCES). The first contrast reproduces
// tests/benchmark/tests/documentAcceptance.test.ts's own comparison
// (medical + patient_instructions vs medical + research_paper) as a
// production benchmark measurement rather than only a live acceptance test.
export const INITIAL_GENRE_AUDIENCE_CONTRASTS: GenreAudienceContrast[] = [
  {
    id: 'patient-instructions-vs-research-paper',
    label: 'Patient Instructions → Research Paper',
    domain: 'medical',
    left: { genre: 'patient_instructions' },
    right: { genre: 'research_paper' },
    expectedDirections: {
      readability: 'higher_left',
      averageSentenceLength: 'higher_right',
      lexicalComplexity: 'higher_right',
    },
  },
  {
    id: 'executive-vs-general-audience',
    label: 'Executive Audience → General Audience',
    domain: null,
    left: { audience: 'executive' },
    right: { audience: 'general' },
    expectedDirections: {
      averageSentenceLength: 'higher_right',
      readability: 'higher_left',
      paragraphLength: 'higher_right',
    },
  },
]

// ── Contrast configuration validation ─────────────────────────────────────

const DIRECTIONS = ['higher_left', 'higher_right'] as const
const EXPECTED_DIRECTION_KEYS = ['readability', 'averageSentenceLength', 'lexicalComplexity', 'paragraphLength', 'firstPersonRate'] as const

// Validates a (possibly user-supplied) contrast list: genre/audience values must be real (style/types.ts),
// each side must set at least one of them, the optional domain must be a real Domain, ids must be unique and
// non-empty, and expected directions must name a known metric with a known direction.
export function validateGenreAudienceContrasts(value: unknown): { contrasts: GenreAudienceContrast[] } | { error: string } {
  if (!Array.isArray(value) || value.length === 0) return { error: 'contrasts must be a non-empty array.' }
  const seen = new Set<string>()
  const out: GenreAudienceContrast[] = []
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) return { error: 'Every contrast must be an object.' }
    const c = raw as Record<string, unknown>
    const id = typeof c['id'] === 'string' ? c['id'].trim() : ''
    if (!id) return { error: 'Every contrast needs an id.' }
    if (/__(left|right)$/.test(id)) return { error: `Contrast id "${id}" must not end in __left or __right.` }
    if (seen.has(id)) return { error: `Duplicate contrast id "${id}".` }
    seen.add(id)
    const label = typeof c['label'] === 'string' && c['label'].trim() ? c['label'].trim() : id
    let domain: Domain | null = null
    if (c['domain'] != null) {
      if (typeof c['domain'] !== 'string' || !(DOMAINS as readonly string[]).includes(c['domain'])) return { error: `Contrast "${id}" domain must be one of: ${DOMAINS.join(', ')}.` }
      domain = c['domain'] as Domain
    }
    const sides: GenreAudienceContrast['left'][] = []
    for (const key of ['left', 'right'] as const) {
      const rawSide = c[key]
      if (typeof rawSide !== 'object' || rawSide === null) return { error: `Contrast "${id}" needs a ${key} side.` }
      const s = rawSide as Record<string, unknown>
      const genre = s['genre'] ?? null
      const audience = s['audience'] ?? null
      if (genre !== null && !(typeof genre === 'string' && (GENRES as readonly string[]).includes(genre))) return { error: `Contrast "${id}" ${key}.genre must be one of: ${GENRES.join(', ')}.` }
      if (audience !== null && !(typeof audience === 'string' && (AUDIENCES as readonly string[]).includes(audience))) return { error: `Contrast "${id}" ${key}.audience must be one of: ${AUDIENCES.join(', ')}.` }
      if (genre === null && audience === null) return { error: `Contrast "${id}" ${key} must set a genre or an audience.` }
      sides.push({ genre: genre as Genre | null, audience: audience as Audience | null })
    }
    const expectedDirections: GenreAudienceContrast['expectedDirections'] = {}
    const rawDirs = c['expectedDirections']
    if (rawDirs !== undefined) {
      if (typeof rawDirs !== 'object' || rawDirs === null) return { error: `Contrast "${id}" expectedDirections must be an object.` }
      for (const [k, v] of Object.entries(rawDirs as Record<string, unknown>)) {
        if (!(EXPECTED_DIRECTION_KEYS as readonly string[]).includes(k)) return { error: `Contrast "${id}" has unknown expected-direction metric "${k}".` }
        if (!(DIRECTIONS as readonly unknown[]).includes(v)) return { error: `Contrast "${id}" ${k} must be higher_left or higher_right.` }
        expectedDirections[k as typeof EXPECTED_DIRECTION_KEYS[number]] = v as 'higher_left' | 'higher_right'
      }
    }
    out.push({ id, label, domain, left: sides[0]!, right: sides[1]!, expectedDirections })
  }
  return { contrasts: out }
}

export interface GenreAudienceCondition {
  sourceId: string
  contrastId: string
  side: 'left' | 'right'
  conditionId: string
}

export function generateA2H14Conditions(sourceIds: string[], contrasts: GenreAudienceContrast[]): GenreAudienceCondition[] {
  const conditions: GenreAudienceCondition[] = []
  for (const sourceId of sourceIds) {
    for (const contrast of contrasts) {
      conditions.push({ sourceId, contrastId: contrast.id, side: 'left', conditionId: leftConditionId(contrast.id) })
      conditions.push({ sourceId, contrastId: contrast.id, side: 'right', conditionId: rightConditionId(contrast.id) })
    }
  }
  return conditions
}

// ── Trial plan (replaces the two runHumaniteDocument calls of runA2H14Trial) ──

export interface A2H14TrialInput {
  sourceId: string
  sourceText: string
  /** The source's own domain; used unless the contrast pins its own. */
  sourceDomain: Domain
  contrast: GenreAudienceContrast
}

export function a2h14Domain(input: A2H14TrialInput): Domain {
  return input.contrast.domain ?? input.sourceDomain
}

// Exactly two 'humanize' calls, [left, right]: same source text, tone fixed at 'balanced', intensity fixed at
// 5, domain = the contrast's domain or else the source's; only genre/audience differ (each normalised with
// toValidGenre/toValidAudience, null when a side leaves one unset).
export function planA2H14Trial(input: A2H14TrialInput): TargetCall[] {
  const domain = a2h14Domain(input)
  const call = (side: GenreAudienceContrast['left']): TargetCall => ({
    operation: 'humanize',
    text: input.sourceText,
    settings: {
      intensity: A2H14_FIXED_INTENSITY,
      tone: A2H14_FIXED_TONE,
      domain,
      genre: toValidGenre(side.genre ?? null),
      audience: toValidAudience(side.audience ?? null),
    },
  })
  return [call(input.contrast.left), call(input.contrast.right)]
}

// What the original recorded as each trial's `condition`.
export function a2h14TrialCondition(input: A2H14TrialInput, side: 'left' | 'right') {
  const domain = a2h14Domain(input)
  const s = side === 'left' ? input.contrast.left : input.contrast.right
  const effective = effectiveIntensity(A2H14_FIXED_INTENSITY, domain)
  return {
    sourceId: input.sourceId,
    contrastId: input.contrast.id,
    side,
    genre: toValidGenre(s.genre ?? null),
    audience: toValidAudience(s.audience ?? null),
    domain,
    intensity: A2H14_FIXED_INTENSITY,
    requestedIntensity: effective.requested,
    appliedIntensity: effective.applied,
    intensityCapped: effective.capped,
  }
}

// ── Measurement / aggregation (§15-16) ────────────────────────────────────
//
// Deterministic metrics only (§16: "no subjective genre classifier"):
// readability (Flesch), average sentence length, and paragraph length reuse
// calculateLocalDiagnostics directly; "lexical complexity" is mapped onto
// that same module's lexical_diversity (type-token ratio) — the one
// vocabulary-breadth statistic already available — since this deployment has
// no dedicated syllable-per-word or rare-word-ratio complexity metric.

export interface GenreAudiencePairMeasurements {
  sourceId: string
  contrastId: string
  readability: StyleToneMetricDelta
  averageSentenceLength: StyleToneMetricDelta
  lexicalComplexity: StyleToneMetricDelta
  paragraphLength: StyleToneMetricDelta
  firstPersonRate: StyleToneMetricDelta
}

function paragraphLength(wordCount: number, paragraphCount: number): number | null {
  return paragraphCount === 0 ? null : wordCount / paragraphCount
}

export function computeGenreAudiencePairMeasurements(sourceId: string, contrastId: string, leftText: string, rightText: string, contrast: GenreAudienceContrast): GenreAudiencePairMeasurements {
  const left = calculateLocalDiagnostics(leftText)
  const right = calculateLocalDiagnostics(rightText)
  return {
    sourceId,
    contrastId,
    readability: metricDelta(left.readability_score, right.readability_score, contrast.expectedDirections.readability),
    averageSentenceLength: metricDelta(left.average_sentence_length, right.average_sentence_length, contrast.expectedDirections.averageSentenceLength),
    lexicalComplexity: metricDelta(left.lexical_diversity, right.lexical_diversity, contrast.expectedDirections.lexicalComplexity),
    paragraphLength: metricDelta(paragraphLength(left.word_count, left.paragraph_count), paragraphLength(right.word_count, right.paragraph_count), contrast.expectedDirections.paragraphLength),
    firstPersonRate: metricDelta(left.first_person_rate, right.first_person_rate, contrast.expectedDirections.firstPersonRate),
  }
}

// Scores one trial from the target's answers to `planA2H14Trial` ([left, right], in plan order).
export function measureA2H14Trial(input: A2H14TrialInput, results: readonly TargetCallResult[]): GenreAudiencePairMeasurements {
  if (results.length !== 2) throw new Error(`A2H-14 trial expects 2 call results (left, right), got ${results.length}.`)
  return computeGenreAudiencePairMeasurements(input.sourceId, input.contrast.id, results[0]!.output, results[1]!.output, input.contrast)
}

export interface GenreAudienceContrastAggregate {
  contrastId: string
  label: string
  n: number
  readability: StyleToneMetricAggregate
  averageSentenceLength: StyleToneMetricAggregate
  lexicalComplexity: StyleToneMetricAggregate
  paragraphLength: StyleToneMetricAggregate
  firstPersonRate: StyleToneMetricAggregate
}

export function aggregateGenreAudienceContrast(pairs: GenreAudiencePairMeasurements[], contrast: GenreAudienceContrast): GenreAudienceContrastAggregate {
  return {
    contrastId: contrast.id,
    label: contrast.label,
    n: pairs.length,
    readability: aggregateMetric(pairs.map(p => p.readability)),
    averageSentenceLength: aggregateMetric(pairs.map(p => p.averageSentenceLength)),
    lexicalComplexity: aggregateMetric(pairs.map(p => p.lexicalComplexity)),
    paragraphLength: aggregateMetric(pairs.map(p => p.paragraphLength)),
    firstPersonRate: aggregateMetric(pairs.map(p => p.firstPersonRate)),
  }
}

export interface A2H14Report {
  contrasts: GenreAudienceContrastAggregate[]
  pairs: GenreAudiencePairMeasurements[]
}

// Pure equivalent of getA2H14Report's final step: aggregates already-measured pairs per contrast.
export function buildA2H14Report(pairs: GenreAudiencePairMeasurements[], contrasts: GenreAudienceContrast[]): A2H14Report {
  const contrastAggregates = contrasts.map(contrast => aggregateGenreAudienceContrast(pairs.filter(p => p.contrastId === contrast.id), contrast))
  return { contrasts: contrastAggregates, pairs }
}

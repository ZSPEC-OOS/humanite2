import { intensityTarget } from '@/lib/intensity'

// Threshold wrappers around the per-dimension scores judge.ts's combined
// structured call produces (tone_alignment, domain_alignment, naturalness)
// plus the deterministic intensity-alignment score computed from Phase 4's
// measureIntensity — turning a raw 0-1 estimate into a pass/fail the same
// conservative way qualityGates.ts's DEFAULT_THRESHOLDS does for fidelity:
// starting values chosen to favor flagging over a false pass, revisit once
// real output distributions are available to calibrate against.
//
// Deliberately NOT wired into runQualityGates' failed_gate/passed (the
// fidelity retry loop) — style is measured and reported here, not yet
// retried. Folding it into the same gate would mean an off-tone but
// perfectly faithful rewrite consumes a fidelity retry attempt for an
// unrelated reason, and risks the already-tested retry/best-tracking logic
// in humanizePipeline.ts for a dimension this phase only commits to
// measuring.

export interface DimensionScore {
  score: number | null
  passed: boolean | null
}

const TONE_ALIGNMENT_THRESHOLD = 0.6
const DOMAIN_ALIGNMENT_THRESHOLD = 0.6
// A floor, not a two-sided proximity target — see evaluateIntensityAlignment.
const INTENSITY_ALIGNMENT_THRESHOLD = 0.5

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n))
}

function evaluateThreshold(score: number | null, threshold: number): DimensionScore {
  return { score, passed: score == null ? null : score >= threshold }
}

export function evaluateTone(score: number | null): DimensionScore {
  return evaluateThreshold(score, TONE_ALIGNMENT_THRESHOLD)
}

export function evaluateDomain(score: number | null): DimensionScore {
  return evaluateThreshold(score, DOMAIN_ALIGNMENT_THRESHOLD)
}

// Reported but never gates `style.passed` — naturalness "carries low weight
// until calibrated against blind human ratings" (see judge.ts) and is a
// rough, uncalibrated judge estimate rather than a real fluency measure.
export function evaluateNaturalness(score: number | null): DimensionScore {
  return { score, passed: null }
}

// How much of this level's design-target transformation magnitude the
// actual rewrite reached. A floor check (>= target scores 1.0), not a
// two-sided proximity score: INTENSITY_TARGETS are explicit, uncalibrated
// DESIGN targets (see intensity/targets.ts's own comment — calibration
// against real output is Phase 11's job), not a proven midpoint to hug, and
// transforming MORE than asked is never itself a defect — that's what the
// fidelity gates already police independently.
//
// Only three of the target's four dimensions have a corresponding measured
// metric today (lexical, sentence, paragraph) — `syntactic` stays null
// pending a parser choice and `discourse` has no token-level proxy (see
// IntensityTarget and evaluation/intensity.ts) — both excluded from the
// comparable target mean rather than treated as 0, which would understate it.
export function evaluateIntensityAlignment(actualMagnitude: number, level: number): DimensionScore {
  const target = intensityTarget(level)
  const targetMagnitude = (target.lexical + target.sentence + target.paragraph) / 3
  const score = targetMagnitude <= 0 ? 1 : clamp01(actualMagnitude / targetMagnitude)
  return evaluateThreshold(score, INTENSITY_ALIGNMENT_THRESHOLD)
}

export interface StyleEvaluation {
  tone_alignment: number | null
  domain_alignment: number | null
  naturalness: number | null
  intensity_alignment: number | null
  passed: boolean | null
}

// Composes the four already-scored dimensions into the single verdict
// humanizeOutput.ts's `style.passed` exposes. Takes scores, not raw judge/
// metric output, so it works the same whether called per-chunk or on an
// already-aggregated document-level average.
export function evaluateStyle(
  toneAlignmentScore: number | null,
  domainAlignmentScore: number | null,
  naturalnessScore: number | null,
  intensityAlignmentScore: number | null,
): StyleEvaluation {
  const tone = evaluateTone(toneAlignmentScore)
  const domain = evaluateDomain(domainAlignmentScore)
  const naturalness = evaluateNaturalness(naturalnessScore)
  const intensity = evaluateThreshold(intensityAlignmentScore, INTENSITY_ALIGNMENT_THRESHOLD)

  const gating = [tone.passed, domain.passed, intensity.passed]
  const passed = gating.every(p => p == null) ? null : gating.every(p => p !== false)

  return {
    tone_alignment: tone.score,
    domain_alignment: domain.score,
    naturalness: naturalness.score,
    intensity_alignment: intensity.score,
    passed,
  }
}

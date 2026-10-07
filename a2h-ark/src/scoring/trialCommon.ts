import { createHash } from 'crypto'
import type { Domain } from '../vendor/style/types'
import type { TargetCall } from '../shared/targetCalls'
import type { DetectionClassification } from '../vendor/detection/contracts'

// The tone every A2H transformation holds constant (Humanite's FIXED_TONE in outputs.ts, a2h07.ts, a2h15.ts).
export const A2H_FIXED_TONE = 'balanced'

export function wordCount(text: string): number {
  const trimmed = text.trim()
  return trimmed ? trimmed.split(/\s+/).length : 0
}

export function sha256Hex(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

// One ordinary Humanize call at the fixed tone, as every A2H transformation performs it.
export function planHumanizeCall(sourceText: string, intensity: number, domain: Domain, candidateCountOverride?: number | null): TargetCall {
  const call: TargetCall = { operation: 'humanize', text: sourceText, settings: { intensity, tone: A2H_FIXED_TONE, domain } }
  if (candidateCountOverride !== undefined) call.candidateCountOverride = candidateCountOverride
  return call
}

// What a detector (GPTZero) answered for one text. Detector scores are INPUTS to the pure scoring
// functions: the pack obtains them through a BenchMarkr service role. `DetectorResult` from
// shared/types is structurally assignable to this.
export interface DetectorScore {
  aiProbability: number | null
  humanProbability: number | null
  mixedProbability: number | null
  classification: DetectionClassification
  analyzedAt: string
  runId: string
}

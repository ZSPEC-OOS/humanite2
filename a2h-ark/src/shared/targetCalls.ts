// The ark's own vocabulary for "what the target is asked to do" and "what it answers". It is the
// contract between the pure scoring modules (src/scoring) and the pack that talks to Humanite's
// benchmark service endpoint (src/pack). Scoring code never calls the target: where Humanite's A2H
// used to call `runHumaniteDocument` / `repairGrammar` / `repairChunk` itself, a scoring module
// instead describes the calls (a `plan…` function returning TargetCall[]) and measures the answers
// (a `measure…` function taking TargetCallResult[]).

import type { Domain } from '../vendor/style/types'

export type TargetOperation = 'humanize' | 'repair_grammar' | 'repair_facts'

export interface HumanizeSettings {
  /** The intensity asked for (1-10). The target may cap it for the domain; see the result. */
  intensity: number
  tone: string
  domain: Domain
  genre?: string | null
  audience?: string | null
}

export interface TargetCall {
  operation: TargetOperation
  /** The text to transform or repair. */
  text: string
  /** `humanize` only. */
  settings?: HumanizeSettings
  /** `humanize` only: force a single candidate (A2H-15's baseline arm) instead of production's selection. */
  candidateCountOverride?: number | null
  /** Operation-specific inputs that are not settings (for example a repair's ledger), JSON only. */
  extra?: Record<string, unknown>
}

export interface TargetTelemetry {
  latencyMs: number | null
  modelCalls: number | null
  inputTokens: number | null
  outputTokens: number | null
  retryCount: number
}

export interface TargetCallResult extends TargetTelemetry {
  /** The transformed or repaired text. */
  output: string
  /** `humanize`: what the target actually applied, which a domain cap can make lower than asked. */
  requestedIntensity?: number
  appliedIntensity?: number
  intensityCapped?: boolean
  candidateCount?: number
  modelUsed?: string
}

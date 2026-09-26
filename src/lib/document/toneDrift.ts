import { measureStyleDiagnostics, type StyleDiagnostics } from '@/lib/style/measure'

// "A final consistency check finds terminology, abbreviation and tone
// drift" — this module covers the tone-drift MEASUREMENT half of that.
// Unlike terminology/abbreviation drift (consistency.ts), which names an
// exact banned string a repair can target, tone drift has no single
// offending span to point at — it's a document-wide register shift (one
// chunk suddenly reads far more/less formal or hedged than the rest),
// visible only in aggregate. Repairing it well would mean either a
// document-wide judge call per chunk (expensive — well past this phase's
// budget) or a whole-chunk regeneration with no more precise a target than
// "sounds different from the others", which risks the regression this
// codebase's every other repair mechanism (Phase 6-8's `isBetterAttempt`)
// is built to guard against. So this stays measured and reported, the same
// deliberate deferral this codebase already made for Binoculars-style
// detection (Phase 6) and the syntactic-difference metric (Phase 4) —
// revisit once there's a cheaper, more targeted way to localize a fix.

export interface ToneDriftReport {
  chunkDiagnostics: StyleDiagnostics[]
  // Indexes into the chunk array whose register deviates from the
  // document's own mean by more than DRIFT_THRESHOLD on contraction rate
  // or hedge density — the two dimensions Phase 3's own acceptance
  // criterion already treats as measurable register signals.
  driftedChunkIndexes: number[]
}

// Not yet calibrated against labeled drift examples — a conservative
// starting point (a chunk whose contraction rate or hedge density differs
// from the document mean by more than 10 percentage points), the same
// "starting value, revisit once calibrated" convention as
// qualityGates.ts's DEFAULT_THRESHOLDS.
const DRIFT_THRESHOLD = 0.1

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length
}

export function detectToneDrift(chunkTexts: string[]): ToneDriftReport {
  const chunkDiagnostics = chunkTexts.map(measureStyleDiagnostics)
  // A single chunk cannot drift from a document mean that is itself just
  // that one chunk.
  if (chunkTexts.length <= 1) return { chunkDiagnostics, driftedChunkIndexes: [] }

  const contractionMean = mean(chunkDiagnostics.map(d => d.contraction_rate))
  const hedgeMean = mean(chunkDiagnostics.map(d => d.hedge_density))

  const driftedChunkIndexes: number[] = []
  chunkDiagnostics.forEach((d, i) => {
    const drifted = Math.abs(d.contraction_rate - contractionMean) > DRIFT_THRESHOLD
      || Math.abs(d.hedge_density - hedgeMean) > DRIFT_THRESHOLD
    if (drifted) driftedChunkIndexes.push(i)
  })

  return { chunkDiagnostics, driftedChunkIndexes }
}

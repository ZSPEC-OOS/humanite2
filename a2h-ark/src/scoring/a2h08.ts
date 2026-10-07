// Ported from humanite2 src/lib/a2h/a2h08.ts @ 141e366. Firestore reporting and the job context removed.
import type { GrammarFinding } from '../shared/types'
import { detectGrammarFindings } from './grammarEngine'
import { summarizeContinuous, type ContinuousSummary } from '../shared/statistics'

export const A2H08_CODE = 'A2H-08' as const

// A2H-08 — Grammar Damage (§12-17). Unlike A2H-06/A2H-12, this is a plain
// output-scoped deterministic test: clean frozen source -> ordinary
// Humanite output -> before/after grammar-engine comparison. It never
// consumes a fixture (§27/§47) and never invokes the repair path (§46).
function wordCount(text: string): number {
  const trimmed = text.trim()
  return trimmed ? trimmed.split(/\s+/).length : 0
}

function normalizeFindingText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim()
}

export interface GrammarFindingMatchResult {
  resolved: GrammarFinding[]
  retained: GrammarFinding[]
  newFindings: GrammarFinding[]
}

// Matches by (ruleId, normalized finding text) rather than by position
// (§16) — a finding whose surrounding sentence moved (intensity-driven
// restructuring) but whose flagged text and rule are unchanged is still
// "retained," never double-counted as "new." Every source finding is
// either matched to exactly one (still-unclaimed) output finding
// ('retained') or has none ('resolved'); every unclaimed output finding is
// 'new'. The full set of source findings is what §16 calls "pre_existing"
// — reported as sourceErrorCount, not a separate per-item bucket.
export function matchGrammarFindings(sourceFindings: GrammarFinding[], outputFindings: GrammarFinding[]): GrammarFindingMatchResult {
  const unclaimedOutput = [...outputFindings]
  const resolved: GrammarFinding[] = []
  const retained: GrammarFinding[] = []
  for (const sf of sourceFindings) {
    const idx = unclaimedOutput.findIndex(of => of.ruleId === sf.ruleId && normalizeFindingText(of.text) === normalizeFindingText(sf.text))
    if (idx === -1) {
      resolved.push(sf)
    } else {
      retained.push(sf)
      unclaimedOutput.splice(idx, 1)
    }
  }
  return { resolved, retained, newFindings: unclaimedOutput }
}

export interface A2H08Measurements {
  eligible: boolean
  sourceWordCount: number
  outputWordCount: number
  sourceErrorCount: number
  outputErrorCount: number
  sourceErrorsPer1000: number
  outputErrorsPer1000: number
  newErrorsPer1000: number
  newErrorCount: number
  resolvedErrorCount: number
  categoryCountsBefore: Record<string, number>
  categoryCountsAfter: Record<string, number>
  zeroNewErrors: boolean
}

function categoryCounts(findings: GrammarFinding[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const f of findings) counts[f.category] = (counts[f.category] ?? 0) + 1
  return counts
}

// Primary metric (§15): newErrorsPer1000 = outputErrorsPer1000 -
// sourceErrorsPer1000. No pass/fail threshold is invented (§32) — this
// test reports measured damage, nothing more.
export function computeA2H08Measurements(sourceText: string, outputText: string): A2H08Measurements {
  const sourceWordCount = wordCount(sourceText)
  const outputWordCount = wordCount(outputText)
  if (sourceWordCount === 0 || outputWordCount === 0) {
    return {
      eligible: false, sourceWordCount, outputWordCount, sourceErrorCount: 0, outputErrorCount: 0,
      sourceErrorsPer1000: 0, outputErrorsPer1000: 0, newErrorsPer1000: 0, newErrorCount: 0, resolvedErrorCount: 0,
      categoryCountsBefore: {}, categoryCountsAfter: {}, zeroNewErrors: true,
    }
  }

  const sourceFindings = detectGrammarFindings(sourceText)
  const outputFindings = detectGrammarFindings(outputText)
  const { resolved, newFindings } = matchGrammarFindings(sourceFindings, outputFindings)

  const sourceErrorsPer1000 = (sourceFindings.length / sourceWordCount) * 1000
  const outputErrorsPer1000 = (outputFindings.length / outputWordCount) * 1000

  return {
    eligible: true,
    sourceWordCount,
    outputWordCount,
    sourceErrorCount: sourceFindings.length,
    outputErrorCount: outputFindings.length,
    sourceErrorsPer1000,
    outputErrorsPer1000,
    newErrorsPer1000: outputErrorsPer1000 - sourceErrorsPer1000,
    newErrorCount: newFindings.length,
    resolvedErrorCount: resolved.length,
    categoryCountsBefore: categoryCounts(sourceFindings),
    categoryCountsAfter: categoryCounts(outputFindings),
    zeroNewErrors: newFindings.length === 0,
  }
}

export function evaluateGrammarDamage(sourceText: string, outputText: string): { passed: null; score: number | null; measurements: A2H08Measurements } {
  const measurements = computeA2H08Measurements(sourceText, outputText)
  return { passed: null, score: measurements.eligible ? measurements.newErrorsPer1000 : null, measurements }
}

// ── Reporting ─────────────────────────────────────────────────────────────

export interface A2H08Aggregate {
  n: number
  newErrorsPer1000: ContinuousSummary
  zeroNewErrorsCount: number
  anyNewErrorsCount: number
  totalNewErrors: number
  newErrorsByCategory: Record<string, number>
}

export function aggregateA2H08(measurements: A2H08Measurements[]): A2H08Aggregate {
  const eligible = measurements.filter(m => m.eligible)
  const newErrorsByCategory: Record<string, number> = {}
  for (const m of eligible) {
    for (const [category, afterCount] of Object.entries(m.categoryCountsAfter)) {
      const beforeCount = m.categoryCountsBefore[category] ?? 0
      const delta = Math.max(0, afterCount - beforeCount)
      if (delta > 0) newErrorsByCategory[category] = (newErrorsByCategory[category] ?? 0) + delta
    }
  }
  return {
    n: eligible.length,
    newErrorsPer1000: summarizeContinuous(eligible.map(m => m.newErrorsPer1000)),
    zeroNewErrorsCount: eligible.filter(m => m.zeroNewErrors).length,
    anyNewErrorsCount: eligible.filter(m => !m.zeroNewErrors).length,
    totalNewErrors: eligible.reduce((sum, m) => sum + m.newErrorCount, 0),
    newErrorsByCategory,
  }
}

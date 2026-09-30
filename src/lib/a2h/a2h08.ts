import type { Firestore } from 'firebase-admin/firestore'
import type { Domain } from '@/lib/style/types'
import type { DeterministicTestContext, DeterministicEvaluation, GrammarFinding } from './types'
import { detectGrammarFindings } from './grammarEngine'
import { summarizeContinuous, groupBy, type ContinuousSummary } from './statistics'
import { listTestResultsForRun } from './testResults'
import { listOutputsForRun } from './outputs'

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

export function evaluateGrammarDamage(ctx: DeterministicTestContext): DeterministicEvaluation {
  const measurements = computeA2H08Measurements(ctx.source.text, ctx.output.outputText)
  return {
    passed: null,
    score: measurements.eligible ? measurements.newErrorsPer1000 : null,
    measurements: measurements as unknown as Record<string, unknown>,
  }
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

export interface A2H08Row {
  sourceId: string
  outputId: string
  domainId: Domain
  topicId: string
  targetWords: number
  intensity: number
  measurements: A2H08Measurements
}

export interface A2H08Filters {
  domainId?: Domain
  topicId?: string
  targetWords?: number
  intensity?: number
}

function matchesFilters(row: A2H08Row, filters?: A2H08Filters): boolean {
  if (!filters) return true
  if (filters.domainId && row.domainId !== filters.domainId) return false
  if (filters.topicId && row.topicId !== filters.topicId) return false
  if (filters.targetWords != null && row.targetWords !== filters.targetWords) return false
  if (filters.intensity != null && row.intensity !== filters.intensity) return false
  return true
}

export async function getA2H08Rows(firestore: Firestore, runId: string, filters?: A2H08Filters): Promise<A2H08Row[]> {
  const [testResults, outputs] = await Promise.all([
    listTestResultsForRun(firestore, runId, A2H08_CODE),
    listOutputsForRun(firestore, runId),
  ])
  const outputsById = new Map(outputs.map(o => [o.id, o]))
  const rows: A2H08Row[] = []
  for (const tr of testResults) {
    if (!tr.outputId) continue
    const output = outputsById.get(tr.outputId)
    if (!output) continue
    const row: A2H08Row = {
      sourceId: tr.sourceId,
      outputId: tr.outputId,
      domainId: output.domainId,
      topicId: output.topicId,
      targetWords: output.targetWords,
      intensity: output.intensity,
      measurements: tr.measurements as unknown as A2H08Measurements,
    }
    if (matchesFilters(row, filters)) rows.push(row)
  }
  return rows
}

export interface A2H08Report {
  overall: A2H08Aggregate
  byDomain: Record<string, A2H08Aggregate>
  byLength: Record<number, A2H08Aggregate>
  byIntensity: Record<number, A2H08Aggregate>
  rows: A2H08Row[]
}

function groupedAggregate<K extends string | number>(rows: A2H08Row[], keyFn: (row: A2H08Row) => K): Record<K, A2H08Aggregate> {
  const groups = groupBy(rows, keyFn)
  const result = {} as Record<K, A2H08Aggregate>
  for (const [key, group] of groups) result[key] = aggregateA2H08(group.map(r => r.measurements))
  return result
}

export async function getA2H08Report(firestore: Firestore, runId: string, filters?: A2H08Filters): Promise<A2H08Report> {
  const rows = await getA2H08Rows(firestore, runId, filters)
  return {
    overall: aggregateA2H08(rows.map(r => r.measurements)),
    byDomain: groupedAggregate(rows, r => r.domainId),
    byLength: groupedAggregate(rows, r => r.targetWords),
    byIntensity: groupedAggregate(rows, r => r.intensity),
    rows,
  }
}

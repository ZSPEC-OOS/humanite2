import type { JsonObject } from '@benchmarkr/core'
import { FrameworkError } from '@benchmarkr/core'
import type { Domain } from '../vendor/style/types'
import type { DetectorScore } from '../scoring/trialCommon'
import type { CorpusDoc } from './data'
import { configError, finite, isRecord, str, toJsonObject } from './util'
import type { AggregateParts, ScoredItem, TrialMeta } from './suite'

/** Facts every trial of a corpus-tied test records about its item. */
export function baseMeta(code: string, doc: CorpusDoc, extra: JsonObject = {}): JsonObject {
  return {
    code,
    sourceId: doc.sourceId,
    itemHash: doc.itemHash,
    domain: doc.domain,
    topicId: doc.topicId,
    targetWords: doc.targetWords,
    sourceWords: doc.actualWords,
    ...extra,
  }
}

export function requireDoc(doc: CorpusDoc | undefined): CorpusDoc {
  if (doc === undefined) throw configError('The trial has no corpus item')
  return doc
}

export function intensityOf(meta: TrialMeta): number {
  const intensity = finite(meta['intensity'])
  if (intensity === undefined) throw configError('The trial has no intensity')
  return intensity
}

export const domainOf = (meta: TrialMeta): Domain => meta.domain as Domain

/** A detector score as JSON (it travels in the verification metadata). */
export function scoreToJson(score: DetectorScore): JsonObject {
  return toJsonObject(score)
}

const CLASSES = new Set(['human-written', 'ai-generated', 'mixed', 'uncertain'])

export function scoreFromJson(value: unknown): DetectorScore {
  if (!isRecord(value) || !CLASSES.has(String(value['classification']))) {
    throw new FrameworkError('SCORING_ERROR', 'The verification carries no detector score')
  }
  return {
    aiProbability: finite(value['aiProbability']) ?? null,
    humanProbability: finite(value['humanProbability']) ?? null,
    mixedProbability: finite(value['mixedProbability']) ?? null,
    classification: value['classification'] as DetectorScore['classification'],
    analyzedAt: str(value['analyzedAt']) ?? '',
    runId: str(value['runId']) ?? '',
  }
}

/** A MetricMap from entries, leaving out what is missing (a missing metric is absent, never zero). */
export function metricMap(entries: Record<string, number | null | undefined>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [name, value] of Object.entries(entries)) {
    if (typeof value === 'number' && Number.isFinite(value)) out[name] = value
  }
  return out
}

/** Drops a report's `rows` (they restate every scored result, which the results already hold). */
export function withoutRows<T extends { rows?: unknown }>(report: T): Omit<T, 'rows'> {
  const { rows: _rows, ...rest } = report
  void _rows
  return rest
}

export const measurementsOf = <T>(items: readonly ScoredItem[]): T[] => items.map((i) => i.measurement as unknown as T)

export function parts(p: {
  numeric: number | null | undefined
  unit: string
  direction?: AggregateParts['direction']
  metrics: Record<string, number | null | undefined>
  report: unknown
}): AggregateParts {
  return {
    numeric: p.numeric ?? null,
    unit: p.unit,
    ...(p.direction === undefined ? {} : { direction: p.direction }),
    metrics: metricMap(p.metrics),
    report: toJsonObject(p.report),
  }
}

export function summaryMetrics(prefix: string, s: { n: number; mean: number | null; median?: number | null; ciLow95?: number | null; ciHigh95?: number | null } | undefined): Record<string, number | null | undefined> {
  if (s === undefined) return {}
  return { [`${prefix}.n`]: s.n, [`${prefix}.mean`]: s.mean, [`${prefix}.median`]: s.median, [`${prefix}.ciLow95`]: s.ciLow95, [`${prefix}.ciHigh95`]: s.ciHigh95 }
}

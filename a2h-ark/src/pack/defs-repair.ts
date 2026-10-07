// A2H-06 (grammar repair) and A2H-12 (factual repair): fixture-scoped. One trial is one fixture: the target is given
// the corrupted text through its repair operation and the answer is classified against the fixture's known answer.
// The known answer (`expected`) is read by the verifier from the fixtures dataset and never reaches the target;
// A2H-12's repair operation does receive the clean text, because the product builds its fact ledger from it.
import {
  measureA2H06,
  planA2H06,
  scoreA2H06,
  toAggregate as aggregateA2H06,
  validateGrammarRepairFixtureExpected,
  type GrammarRepairFixtureExpected,
  type GrammarRepairFixtureResult,
} from '../scoring/a2h06'
import {
  measureA2H12,
  planA2H12,
  scoreA2H12,
  toAggregate as aggregateA2H12,
  validateFactualRepairFixtureExpected,
  type FactualRepairFixtureExpected,
  type FactualRepairFixtureResult,
} from '../scoring/a2h12'
import { measurementsOf, parts } from './defs-common'
import { configError, toJsonObject } from './util'
import type { TestDef, TrialMeta } from './suite'

function fixtureMeta(code: string, input: Parameters<TestDef['buildSpec']>[0]): Record<string, string | number> {
  const fixture = input.fixture
  if (fixture === undefined) throw configError('The trial has no fixture')
  const doc = input.doc
  return {
    code,
    sourceId: fixture.sourceId,
    itemHash: doc?.itemHash ?? '',
    domain: doc?.domain ?? fixture.domain ?? 'general',
    topicId: doc?.topicId ?? '',
    targetWords: doc?.targetWords ?? fixture.words ?? 0,
    sourceWords: doc?.actualWords ?? 0,
    fixtureKey: fixture.key,
    fixtureId: fixture.id,
  }
}

const truncate = (text: string | null, max = 4000): string | null => (text === null ? null : text.length > max ? text.slice(0, max) : text)

export const a2h06: TestDef = {
  code: 'A2H-06',
  category: 'repair',
  description:
    'Grammar repair: each fixture is a clean passage with one inserted grammatical error. The target repairs the corrupted text and the result is classified deterministically as corrected, not corrected, partially corrected, overcorrected or new error introduced.',
  defaultEnabled: false,
  experimental: false,
  needsDetector: false,
  needsFixtures: true,
  timeoutMs: 300_000,
  defaultTrialCount: 10,
  design: () => ({ pool: 'fixtures', fixtureType: 'grammar_repair', cohort: 'grammar_repair', cells: 1 }),
  buildSpec(input) {
    const fixture = input.fixture
    if (fixture === undefined) throw configError('The trial has no fixture')
    const errors = validateGrammarRepairFixtureExpected(fixture.expected)
    if (errors.length > 0) throw configError('A grammar-repair fixture is invalid', { itemKey: fixture.key })
    return { calls: planA2H06(fixture.expected as unknown as GrammarRepairFixtureExpected), meta: fixtureMeta('A2H-06', input) }
  },
  async evaluate(ctx) {
    const fixture = await ctx.fixture()
    const result = measureA2H06(fixture.id, fixture.expected as unknown as GrammarRepairFixtureExpected, ctx.results[0] ?? null)
    return {
      // Humanite persisted passed = null and score = 1 for 'corrected', else 0.
      passed: null,
      numeric: scoreA2H06(result),
      unit: 'ratio',
      eligible: true,
      measurement: toJsonObject({ ...result, repairedText: truncate(result.repairedText) }),
    }
  },
  aggregate(items) {
    const results = measurementsOf<GrammarRepairFixtureResult>(items)
    const a = aggregateA2H06(results)
    return parts({
      numeric: a.repairRate.successRate,
      unit: 'ratio',
      direction: 'higher-is-better',
      metrics: { n: a.n, repairRate: a.repairRate.successRate, ciLow95: a.repairRate.ciLow95, ciHigh95: a.repairRate.ciHigh95, remainingErrors: a.remainingErrorCount, partialCorrections: a.partialCorrectionCount, overcorrections: a.overcorrectionCount, newErrors: a.newErrorCount },
      report: { ...a, byCategory: byCategory(results, (r) => r.status === 'corrected') },
    })
  },
}

export const a2h12: TestDef = {
  code: 'A2H-12',
  category: 'repair',
  description:
    'Factual repair: each fixture is a clean passage with one factual corruption (number, unit, negation, modality, comparator, sign, range, notation, version, entity, cross reference, relationship). The target repairs the corrupted text against the clean one and the result is classified deterministically: fully repaired, partially repaired, not repaired or new corruption.',
  defaultEnabled: false,
  experimental: false,
  needsDetector: false,
  needsFixtures: true,
  timeoutMs: 300_000,
  defaultTrialCount: 10,
  design: () => ({ pool: 'fixtures', fixtureType: 'factual_repair', cohort: 'factual_repair', cells: 1 }),
  buildSpec(input) {
    const fixture = input.fixture
    if (fixture === undefined) throw configError('The trial has no fixture')
    const errors = validateFactualRepairFixtureExpected(fixture.expected)
    if (errors.length > 0) throw configError('A factual-repair fixture is invalid', { itemKey: fixture.key })
    const meta = fixtureMeta('A2H-12', input)
    return { calls: planA2H12(fixture.expected as unknown as FactualRepairFixtureExpected, String(meta['domain'])), meta }
  },
  async evaluate(ctx) {
    const fixture = await ctx.fixture()
    const result = measureA2H12(fixture.id, fixture.expected as unknown as FactualRepairFixtureExpected, ctx.results[0] ?? null)
    return {
      passed: null,
      numeric: scoreA2H12(result),
      unit: 'ratio',
      eligible: true,
      measurement: toJsonObject({ ...result, repairedText: truncate(result.repairedText) }),
    }
  },
  aggregate(items) {
    const results = measurementsOf<FactualRepairFixtureResult>(items)
    const a = aggregateA2H12(results)
    return parts({
      numeric: a.repairRate.successRate,
      unit: 'ratio',
      direction: 'higher-is-better',
      metrics: { n: a.n, repairRate: a.repairRate.successRate, ciLow95: a.repairRate.ciLow95, ciHigh95: a.repairRate.ciHigh95, partialRepairs: a.partialRepairCount, newCorruptions: a.newCorruptionCount },
      report: { ...a, byCategory: byCategory(results, (r) => r.status === 'fully_repaired') },
    })
  },
}

function byCategory<T extends { category: string }>(results: readonly T[], success: (r: T) => boolean): Record<string, { n: number; successCount: number }> {
  const out: Record<string, { n: number; successCount: number }> = {}
  for (const r of results) {
    const entry = (out[r.category] ??= { n: 0, successCount: 0 })
    entry.n += 1
    if (success(r)) entry.successCount += 1
  }
  return out
}

export type { TrialMeta }

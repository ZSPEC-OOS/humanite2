// The output-scoped deterministic tests: A2H-04, 05, 09, 10, 13 and 16 score an ordinary Humanize output against
// the source's fixtures of one type; A2H-08 scores it against the source text with the grammar engine. One trial is
// one Humanize call at a requested intensity. No detector and no judge: the evaluators are the ark's pure ones.
import { aggregateA2H04, type A2H04Measurements } from '../scoring/a2h04'
import { aggregateA2H05, type A2H05Measurements } from '../scoring/a2h05'
import { aggregateA2H08, evaluateGrammarDamage, type A2H08Measurements } from '../scoring/a2h08'
import { aggregateA2H09, type A2H09Measurements } from '../scoring/a2h09'
import { aggregateA2H10, type A2H10Measurements } from '../scoring/a2h10'
import { aggregateA2H13, type A2H13Measurements } from '../scoring/a2h13'
import { aggregateA2H16, type A2H16Measurements } from '../scoring/a2h16'
import { DETERMINISTIC_EVALUATORS } from '../scoring/deterministicEvaluators'
import { planHumanizeCall } from '../scoring/trialCommon'
import type { A2HFixtureType, A2HTestCode } from '../shared/types'
import { baseMeta, measurementsOf, parts, requireDoc } from './defs-common'
import { configError, toJsonObject } from './util'
import type { AggregateParts, ScoredItem, TestDef } from './suite'

interface FixtureTestSpec {
  readonly code: A2HTestCode
  readonly fixtureType: A2HFixtureType
  readonly description: string
  aggregate(items: readonly ScoredItem[]): AggregateParts
}

function fixtureTest(spec: FixtureTestSpec): TestDef {
  const evaluator = DETERMINISTIC_EVALUATORS[spec.code]
  if (evaluator === undefined) throw new Error(`No deterministic evaluator for ${spec.code}`)
  return {
    code: spec.code,
    category: 'preservation',
    description: spec.description,
    defaultEnabled: false,
    experimental: false,
    needsDetector: false,
    needsFixtures: true,
    timeoutMs: 600_000,
    defaultTrialCount: 50,
    design: (o) => ({ pool: 'corpus-with-fixtures', fixtureType: spec.fixtureType, cohort: 'main', cells: o.intensities.length }),
    buildSpec({ doc, cell }, o) {
      const source = requireDoc(doc)
      const intensity = o.intensities[cell] as number
      return { calls: [planHumanizeCall(source.text, intensity, source.domain)], meta: baseMeta(spec.code, source, { intensity }) }
    },
    async evaluate(ctx) {
      const fixtures = await ctx.fixturesOfType(spec.fixtureType)
      const output = ctx.results[0]?.output
      if (output === undefined) throw configError('The target produced no output')
      const evaluation = evaluator([...fixtures], output)
      const eligible = (evaluation.measurements as { eligible?: boolean }).eligible !== false
      return { passed: evaluation.passed, numeric: evaluation.score, unit: 'ratio', eligible, measurement: toJsonObject(evaluation.measurements) }
    },
    aggregate: spec.aggregate,
  }
}

export const a2h04 = fixtureTest({
  code: 'A2H-04',
  fixtureType: 'citation',
  description: 'Citations in the source (numeric, author-year, DOI, figure, table, section) must survive transformation verbatim, allowing only a narrow normalisation. Passes when none is missing, modified or duplicated.',
  aggregate(items) {
    const a = aggregateA2H04(measurementsOf<A2H04Measurements>(items))
    return parts({
      numeric: a.preservationRate.successRate,
      unit: 'ratio',
      direction: 'higher-is-better',
      metrics: { n: a.n, eligibleN: a.eligibleN, fixtureCount: a.fixtureCount, preservationRate: a.preservationRate.successRate, ciLow95: a.preservationRate.ciLow95, ciHigh95: a.preservationRate.ciHigh95, missing: a.missingCount, modified: a.modifiedCount, duplicated: a.duplicatedCount, unexpected: a.unexpectedCount },
      report: a,
    })
  },
})

export const a2h05 = fixtureTest({
  code: 'A2H-05',
  fixtureType: 'numeric_unit',
  description: 'Numbers and units in the source (values, units, signs, ranges, scientific notation, versions) must survive transformation unchanged.',
  aggregate(items) {
    const a = aggregateA2H05(measurementsOf<A2H05Measurements>(items))
    return parts({
      numeric: a.preservationRate.successRate,
      unit: 'ratio',
      direction: 'higher-is-better',
      metrics: { n: a.n, eligibleN: a.eligibleN, fixtureCount: a.fixtureCount, preservationRate: a.preservationRate.successRate, ciLow95: a.preservationRate.ciLow95, ciHigh95: a.preservationRate.ciHigh95, valueChanged: a.valueChangedCount, unitChanged: a.unitChangedCount, signFlipped: a.signFlippedCount, rangeAltered: a.rangeAlteredCount, scientificNotationAltered: a.scientificNotationAlteredCount, versionChanged: a.versionChangedCount },
      report: a,
    })
  },
})

export const a2h09 = fixtureTest({
  code: 'A2H-09',
  fixtureType: 'modality',
  description: 'Negations and modal force (must, may, should, cannot ...) in the source must not be reversed, strengthened, weakened or dropped by the transformation.',
  aggregate(items) {
    const a = aggregateA2H09(measurementsOf<A2H09Measurements>(items))
    return parts({
      numeric: a.preservationRate.successRate,
      unit: 'ratio',
      direction: 'higher-is-better',
      metrics: { n: a.n, eligibleN: a.eligibleN, fixtureCount: a.fixtureCount, preservationRate: a.preservationRate.successRate, ciLow95: a.preservationRate.ciLow95, ciHigh95: a.preservationRate.ciHigh95, reversed: a.reversedCount, strengthened: a.strengthenedCount, weakened: a.weakenedCount },
      report: a,
    })
  },
})

export const a2h10 = fixtureTest({
  code: 'A2H-10',
  fixtureType: 'protected_term',
  description: 'Protected terms in the source (names, identifiers, defined terms) must appear in the output exactly as in the source.',
  aggregate(items) {
    const a = aggregateA2H10(measurementsOf<A2H10Measurements>(items))
    return parts({
      numeric: a.preservationRate.successRate,
      unit: 'ratio',
      direction: 'higher-is-better',
      metrics: { n: a.n, eligibleN: a.eligibleN, fixtureCount: a.fixtureCount, preservationRate: a.preservationRate.successRate, ciLow95: a.preservationRate.ciLow95, ciHigh95: a.preservationRate.ciHigh95, missing: a.missingCount, modified: a.modifiedCount, duplicated: a.duplicatedCount },
      report: a,
    })
  },
})

export const a2h13 = fixtureTest({
  code: 'A2H-13',
  fixtureType: 'terminology',
  description: 'A term the source uses consistently must stay consistent in the output: the controlled form is kept and forbidden variants do not appear.',
  aggregate(items) {
    const a = aggregateA2H13(measurementsOf<A2H13Measurements>(items))
    return parts({
      numeric: a.consistencyRate.successRate,
      unit: 'ratio',
      direction: 'higher-is-better',
      metrics: { n: a.n, eligibleN: a.eligibleN, controlledOccurrences: a.controlledOccurrenceCount, consistencyRate: a.consistencyRate.successRate, ciLow95: a.consistencyRate.ciLow95, ciHigh95: a.consistencyRate.ciHigh95, forbiddenVariants: a.forbiddenVariantCount, unexpectedVariants: a.unexpectedVariantCount },
      report: a,
    })
  },
})

export const a2h16 = fixtureTest({
  code: 'A2H-16',
  fixtureType: 'claim_relationship',
  description: 'Claim relationships in the source (causal, comparative, attribution, qualifier, condition, exception) must survive transformation; a corrupted relationship fails the source.',
  aggregate(items) {
    const a = aggregateA2H16(measurementsOf<A2H16Measurements>(items))
    return parts({
      numeric: a.preservationRate,
      unit: 'ratio',
      direction: 'higher-is-better',
      metrics: { n: a.n, eligibleN: a.eligibleN, fixtureCount: a.fixtureCount, preserved: a.preservedCount, corrupted: a.corruptedCount, uncertain: a.uncertainCount, preservationRate: a.preservationRate },
      report: a,
    })
  },
})

export const a2h08: TestDef = {
  code: 'A2H-08',
  category: 'repair',
  description:
    'Grammar damage: the deterministic grammar engine compares the source and the output and reports the errors the transformation introduced per 1000 words. A measurement, never a pass or fail.',
  defaultEnabled: false,
  experimental: false,
  needsDetector: false,
  needsFixtures: false,
  timeoutMs: 600_000,
  defaultTrialCount: 50,
  design: (o) => ({ pool: 'corpus', cohort: 'main', cells: o.intensities.length }),
  buildSpec({ doc, cell }, o) {
    const source = requireDoc(doc)
    const intensity = o.intensities[cell] as number
    return { calls: [planHumanizeCall(source.text, intensity, source.domain)], meta: baseMeta('A2H-08', source, { intensity }) }
  },
  evaluate(ctx) {
    const output = ctx.results[0]?.output
    if (output === undefined) throw configError('The target produced no output')
    const e = evaluateGrammarDamage(ctx.sourceText, output)
    // passed is always null: Humanite invented no threshold for grammar damage and neither does the pack.
    return Promise.resolve({ passed: e.passed, numeric: e.score, unit: 'errors-per-1000-words', eligible: e.measurements.eligible, measurement: toJsonObject(e.measurements) })
  },
  aggregate(items) {
    const a = aggregateA2H08(measurementsOf<A2H08Measurements>(items))
    return parts({
      numeric: a.newErrorsPer1000.mean,
      unit: 'errors-per-1000-words',
      direction: 'lower-is-better',
      metrics: { n: a.n, zeroNewErrors: a.zeroNewErrorsCount, anyNewErrors: a.anyNewErrorsCount, totalNewErrors: a.totalNewErrors, newErrorsPer1000: a.newErrorsPer1000.mean, newErrorsPer1000_ciLow95: a.newErrorsPer1000.ciLow95, newErrorsPer1000_ciHigh95: a.newErrorsPer1000.ciHigh95 },
      report: a,
    })
  },
}

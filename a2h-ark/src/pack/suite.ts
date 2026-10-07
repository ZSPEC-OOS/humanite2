// The vocabulary the 17 test definitions share: what a test is, the context its methods run in, the options that
// shape the design of the experimental tests, and the helpers every test uses.
import type { JsonObject } from '@benchmarkr/core'
import type { BenchmarkRuntime, TrialSpec } from '@benchmarkr/contracts'
import type { A2HFixtureType, A2HTestCode, GenreAudienceContrast, StyleToneContrast } from '../shared/types'
import type { TargetCall } from '../shared/targetCalls'
import type { A2H15TargetResult } from '../scoring/a2h15'
import type { CorpusDoc, FixtureDoc, FixtureIndex } from './data'

export const MAIN_INTENSITIES: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

/**
 * The design parameters of the tests. They shape which trials exist, so the effective values are written into the
 * catalog (and therefore into the package checksum): change them only together with a package version.
 */
export interface PackOptions {
  readonly version?: string
  /** Requested intensities for A2H-01, 02, 04, 05, 08, 09, 10, 13 and 16. Default 1..10. */
  readonly intensities?: readonly number[]
  /** A2H-07. Humanite's defaults: 5 repeats at intensities 3, 6 and 9. */
  readonly repeatability?: { readonly repeatCount: number; readonly intensities: readonly number[] }
  /** A2H-11. Default: Humanite's three tone contrasts. */
  readonly styleToneContrasts?: readonly StyleToneContrast[]
  /** A2H-14. Default: Humanite's two contrasts. */
  readonly genreAudienceContrasts?: readonly GenreAudienceContrast[]
  /** A2H-15. Default 5 and 8 (only intensities that run candidate search count). */
  readonly candidateSelectionIntensities?: readonly number[]
}

export interface ResolvedOptions {
  readonly version: string
  readonly intensities: readonly number[]
  readonly repeatability: { readonly repeatCount: number; readonly intensities: readonly number[] }
  readonly styleToneContrasts: readonly StyleToneContrast[]
  readonly genreAudienceContrasts: readonly GenreAudienceContrast[]
  readonly candidateSelectionIntensities: readonly number[]
}

/** How a test lays its trials out over the data: which items, and how many trials per item. */
export interface Design {
  /** 'none': the test has no trials of its own (A2H-03 and A2H-17 are roll-ups). */
  readonly pool: 'none' | 'corpus' | 'corpus-with-fixtures' | 'fixtures'
  readonly fixtureType?: A2HFixtureType
  /** Tests with the same cohort and pool draw the same items (A2H-01, 02, 08 and the preservation tests). */
  readonly cohort: string
  /** Trials per item (the cells of the design: intensities, repeats, contrasts, arms). */
  readonly cells: number
}

/** What every trial's metadata says about what it measures; scoring and aggregation read only this. */
export interface TrialMeta extends JsonObject {
  readonly code: string
  readonly sourceId: string
  readonly itemHash: string
  readonly domain: string
  readonly topicId: string
  readonly targetWords: number
  readonly sourceWords: number
  /** The REQUESTED intensity, when the trial has one. */
  readonly intensity?: number
  readonly fixtureKey?: string
}

export interface BuiltSpec {
  readonly calls: readonly TargetCall[]
  /** Added to the common meta (cell-specific facts: intensity, repeat, contrast ...). */
  readonly meta: JsonObject
}

/** The inputs of `buildSpec`: the item (corpus or fixture) the trial is tied to and the cell of the design. */
export interface SpecInput {
  readonly doc: CorpusDoc | undefined
  readonly fixture: FixtureDoc | undefined
  readonly cell: number
}

export interface EvalContext {
  readonly trial: TrialSpec
  readonly meta: TrialMeta
  readonly results: readonly A2H15TargetResult[]
  /** The text of the trial's first call: the source for humanize tests, the corrupted text for repair tests. */
  readonly sourceText: string
  readonly runtime: BenchmarkRuntime | undefined
  /** The source's fixtures of a type (empty when the source has none). */
  fixturesOfType(type: A2HFixtureType): Promise<readonly FixtureDoc[]>
  /** The fixture a fixture-scoped trial (A2H-06, A2H-12) is about. */
  fixture(): Promise<FixtureDoc>
  readonly fixtureIndex: () => Promise<FixtureIndex>
}

export interface Evaluated {
  /** The test's own pass rule where Humanite had one; null otherwise. */
  readonly passed: boolean | null
  /** What Humanite persisted as the result's `score`; null when there is none (for example, ineligible). */
  readonly numeric: number | null
  readonly unit: string
  readonly eligible: boolean
  /** Compact and JSON-safe: exactly what the test's aggregate reads. */
  readonly measurement: JsonObject
}

/** One scored trial as aggregation sees it (read back from the scored result's metadata). */
export interface ScoredItem {
  readonly trialId: string
  readonly meta: TrialMeta
  readonly measurement: JsonObject
  readonly model: string
  readonly attempt: number
}

export interface AggregateParts {
  /** The headline number, absent when there is nothing to report. */
  readonly numeric: number | null
  readonly unit: string
  readonly direction?: 'higher-is-better' | 'lower-is-better'
  readonly metrics: Record<string, number>
  readonly report: JsonObject
}

export interface TestDef {
  readonly code: A2HTestCode
  readonly category: 'conversion' | 'preservation' | 'repair' | 'experiments' | 'operations'
  readonly description: string
  readonly defaultEnabled: boolean
  readonly experimental: boolean
  readonly needsDetector: boolean
  readonly needsFixtures: boolean
  readonly timeoutMs: number
  readonly defaultTrialCount: number
  design(options: ResolvedOptions): Design
  buildSpec(input: SpecInput, options: ResolvedOptions): BuiltSpec
  /** Outside services (the detector): verify only. Its answer travels in the verification metadata. */
  detect?(context: EvalContext, services: import('@benchmarkr/contracts').ServiceAccess | undefined, batchId: string): Promise<JsonObject>
  evaluate(context: EvalContext, detected: JsonObject | undefined): Promise<Evaluated>
  aggregate(items: readonly ScoredItem[]): AggregateParts
}

export const uniq = <T>(values: readonly T[]): T[] => [...new Set(values)]

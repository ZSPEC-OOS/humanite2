// The benchmark package 'com.humanite.a2h': the 17 A2H tests as a dataset-driven BenchMarkr package.
//
//   planTrials       how many trials a test has (items x cells, within the operator's budget; 0 for A2H-03 and 17)
//   createTrialSpec  ties a trial index to (item, cell) and builds the target calls (the plan... functions)
//   verify           checks the target's evidence, reaches the detector (baseline through the memo), and evaluates the
//                    trial once with the measure.../evaluate... functions; the outcome rides in verification.metadata
//   score            turns that outcome into a scored result (status, value, metrics, compact measurement)
//   aggregate        per test: the test's aggregate report; per category: counts; batch: the A2H-03 and A2H-17 roll-ups
//
// score() is not given the TrialSpec, so everything it needs is put into the verification metadata by verify().
import {
  FrameworkError,
  parseBenchmarkTestId,
  parseTrialId,
  sha256Hex,
  type AggregateResult,
  type BenchmarkTestId,
  type JsonObject,
  type JsonValue,
  type MetricMap,
} from '@benchmarkr/core'
import {
  evaluateTargetCapabilities,
  type AggregationContext,
  type BenchmarkExecutionContext,
  type BenchmarkPackage,
  type BenchmarkRuntime,
  type PlanTrialsContext,
  type ScoredResult,
  type TrialSpec,
  type VerificationCheck,
  type VerificationResult,
} from '@benchmarkr/contracts'
import { operationRecordFromCall, type OperationRecord, type OperationType } from '../scoring/a2h17'
import type { A2H15TargetResult } from '../scoring/a2h15'
import type { TargetCall } from '../shared/targetCalls'
import { A2H_TEST_LABELS } from '../shared/types'
import { buildCatalog, buildManifest, defByCode } from './catalog'
import { CORPUS_INPUT, FIXTURES_INPUT, corpusDocOf, fixtureIndex, fixturesFor, type CorpusDoc } from './data'
import { a2h03Rollup, a2h17Rollup } from './defs-rollups'
import { resolveOptions } from './options'
import { locate, selectionFor } from './plan'
import type { Evaluated, EvalContext, PackOptions, ScoredItem, TestDef, TrialMeta } from './suite'
import { configError, finite, isRecord, str, toJson, toJsonObject, SCORING_VERSION } from './util'

const textOf = (value: unknown): string => (typeof value === 'string' ? value : '')

function defOf(testId: string): TestDef {
  const def = defByCode(testId)
  if (def === undefined) throw configError('Unknown A2H test', { testId })
  return def
}

/** The target's per-call answers, as the adapter wrote them into the evidence. */
export function decodeCalls(evidence: JsonObject): A2H15TargetResult[] {
  const calls = evidence['calls']
  if (!Array.isArray(calls)) return []
  const results: A2H15TargetResult[] = []
  for (const entry of calls as unknown[]) {
    if (!isRecord(entry) || typeof entry['output'] !== 'string') return []
    const result: { -readonly [K in keyof A2H15TargetResult]: A2H15TargetResult[K] } = {
      output: entry['output'],
      latencyMs: finite(entry['latencyMs']) ?? null,
      modelCalls: finite(entry['modelCalls']) ?? null,
      inputTokens: finite(entry['inputTokens']) ?? null,
      outputTokens: finite(entry['outputTokens']) ?? null,
      retryCount: finite(entry['retryCount']) ?? 0,
    }
    const requested = finite(entry['requestedIntensity'])
    if (requested !== undefined) result.requestedIntensity = requested
    const applied = finite(entry['appliedIntensity'])
    if (applied !== undefined) result.appliedIntensity = applied
    if (typeof entry['intensityCapped'] === 'boolean') result.intensityCapped = entry['intensityCapped']
    const candidates = finite(entry['candidateCount'])
    if (candidates !== undefined) result.candidateCount = candidates
    const model = str(entry['modelUsed'])
    if (model !== undefined) result.modelUsed = model
    if (entry['candidateSelection'] !== undefined) result.candidateSelection = entry['candidateSelection'] as NonNullable<A2H15TargetResult['candidateSelection']> | null
    if (typeof entry['gatesUnavailable'] === 'boolean' || entry['gatesUnavailable'] === null) result.gatesUnavailable = entry['gatesUnavailable']
    if (typeof entry['gatePassed'] === 'boolean' || entry['gatePassed'] === null) result.gatePassed = entry['gatePassed']
    results.push(result)
  }
  return results
}

function metaOf(metadata: JsonObject): TrialMeta {
  const meta = metadata['a2h']
  if (!isRecord(meta) || typeof meta['code'] !== 'string') throw configError('The trial carries no A2H metadata')
  return meta as unknown as TrialMeta
}

const OPERATION_FOR: Partial<Record<string, OperationType>> = {
  'A2H-06': 'repair',
  'A2H-12': 'repair',
  'A2H-07': 'trial_a2h07',
  'A2H-11': 'trial_a2h11',
  'A2H-14': 'trial_a2h14',
  'A2H-15': 'trial_a2h15',
}

/** One operation record per target call, as Humanite's A2H-17 collected them (see collectOperationRecords). */
function operationsFor(meta: TrialMeta, calls: readonly TargetCall[], results: readonly A2H15TargetResult[], attempt: number): OperationRecord[] {
  const operation = OPERATION_FOR[meta.code] ?? 'humanite_transform'
  const benchmarkCode = operation === 'humanite_transform' ? null : (meta.code as OperationRecord['benchmarkCode'])
  return results.map((result, i) =>
    operationRecordFromCall(
      {
        operation,
        benchmarkCode,
        domainId: meta.domain as OperationRecord['domainId'],
        targetWords: meta.targetWords,
        intensity: calls[i]?.settings?.intensity ?? null,
        requestedIntensity: result.requestedIntensity ?? null,
        appliedIntensity: result.appliedIntensity ?? null,
        intensityCapped: result.intensityCapped ?? null,
        model: result.modelUsed ?? 'unspecified',
        estimatedCostUsd: null,
        status: 'success',
        errorCode: null,
        errorMessage: null,
        jobAttemptCount: attempt,
      },
      result,
    ),
  )
}

function statusOf(evaluated: { passed: boolean | null; eligible: boolean }): string {
  if (!evaluated.eligible) return 'NOT_ELIGIBLE'
  return evaluated.passed === true ? 'PASS' : evaluated.passed === false ? 'FAIL' : 'MEASURED'
}

/** The scored results that carry a measurement (an ERROR or malformed result carries none). */
function itemsOf(results: readonly ScoredResult[]): Array<ScoredItem & { testId: string; operations: OperationRecord[] }> {
  const items: Array<ScoredItem & { testId: string; operations: OperationRecord[] }> = []
  for (const result of results) {
    const meta = result.metadata['a2h']
    const measurement = result.metadata['measurement']
    if (result.status === 'ERROR' || !isRecord(meta) || !isRecord(measurement)) continue
    items.push({
      testId: result.testId,
      trialId: result.trialId,
      meta: meta as unknown as TrialMeta,
      measurement: measurement as JsonObject,
      model: str(result.metadata['model']) ?? 'unspecified',
      attempt: finite(result.metadata['attempt']) ?? 1,
      operations: Array.isArray(result.metadata['operations']) ? (result.metadata['operations'] as unknown as OperationRecord[]) : [],
    })
  }
  return items
}

const countBy = (results: readonly ScoredResult[], status: string): number => results.filter((r) => r.status === status).length

export function createA2hBenchmarkPackage(packOptions: PackOptions = {}): BenchmarkPackage {
  const options = resolveOptions(packOptions)
  const manifest = buildManifest(options)
  const catalog = buildCatalog(options)

  async function plannedItemCount(def: TestDef, context: BenchmarkExecutionContext) {
    const design = def.design(options)
    const planned = context.manifest.selection.plannedTrials?.[def.code]
    const datasets = context.datasets
    if (datasets === undefined) throw configError('No dataset is bound')
    return selectionFor(design, datasets, context.manifest.selection.trialsPerTest, planned === undefined ? undefined : Math.round(planned / design.cells))
  }

  return {
    manifest: () => manifest,
    catalog: () => catalog,
    validateTarget: (capabilities) => evaluateTargetCapabilities(manifest, capabilities),

    async planTrials(testId: BenchmarkTestId, context: PlanTrialsContext): Promise<number> {
      const def = defOf(testId)
      const design = def.design(options)
      if (design.pool === 'none') return 0
      if (context.datasets === undefined) throw configError('No dataset is bound')
      return (await selectionFor(design, context.datasets, context.requestedTrials)).total
    },

    async createTrialSpec(testId, context): Promise<TrialSpec> {
      const def = defOf(testId)
      const datasets = context.datasets
      if (datasets === undefined) throw configError('No dataset is bound')
      const identity = context.trial ?? {
        trialId: parseTrialId(`tri_${sha256Hex(`${context.batchId}|${testId}`).slice(0, 24)}`),
        trialIndex: 0,
        attempt: 1,
      }
      const selection = await plannedItemCount(def, context)
      const { entry, cell } = locate(selection, identity.trialIndex)
      const design = def.design(options)

      let doc: CorpusDoc | undefined
      let fixture
      if (design.pool === 'fixtures') {
        fixture = (await fixtureIndex(datasets)).byKey.get(entry.key)
        if (fixture === undefined) throw configError('The fixture for this trial is missing', { testId })
        const source = await datasets.get(CORPUS_INPUT, fixture.sourceId)
        doc = source === undefined ? undefined : corpusDocOf(source)
      } else {
        const item = await datasets.get(CORPUS_INPUT, entry.key)
        if (item === undefined) throw configError('The corpus item for this trial is missing', { testId, itemKey: entry.key })
        doc = corpusDocOf(item)
      }
      const built = def.buildSpec({ doc, fixture, cell }, options)
      return {
        trialId: identity.trialId,
        batchId: context.batchId,
        testId,
        trialIndex: identity.trialIndex,
        attempt: identity.attempt,
        timeoutMs: def.timeoutMs,
        // All the target ever sees: the calls. Fixture answers and the detector never appear here.
        parameters: { calls: toJson(built.calls) },
        metadata: { itemKey: entry.key, a2h: built.meta },
      }
    },

    async verify(trial, targetResult, _fixture, runtime): Promise<VerificationResult> {
      const def = defOf(trial.testId)
      const meta = metaOf(trial.metadata)
      const calls = trial.parameters['calls'] as unknown as TargetCall[]
      const metadataBase: JsonObject = { testId: trial.testId, attempt: trial.attempt, a2h: meta }
      const inconclusive = (name: string, message: string): VerificationResult => ({
        trialId: trial.trialId,
        status: 'inconclusive',
        checks: [{ name, passed: false, message }],
        artifacts: [],
        metadata: { ...metadataBase, reason: name },
      })
      if (targetResult.outcome !== 'completed') return inconclusive('target-completed', 'The target did not complete the trial')
      const results = decodeCalls(targetResult.evidence)
      if (results.length !== calls.length) return inconclusive('call-count', 'The target returned a different number of outputs than calls')
      // A transformation with no text is a failed transformation; an empty repair is a (failed) repair result.
      const repairs = calls.every((c) => c.operation !== 'humanize')
      if (!repairs && results.some((r) => r.output.trim() === '')) return inconclusive('output-present', 'The target returned an empty output')

      const context = evalContext(trial, meta, results, runtime)
      const detected = def.detect === undefined ? undefined : await def.detect(context, runtime?.services, trial.batchId)
      const evaluated = await def.evaluate(context, detected)
      const checks: VerificationCheck[] = [
        { name: 'target-completed', passed: true },
        { name: 'outputs-present', passed: true },
        { name: 'evaluated', passed: true },
      ]
      if (evaluated.passed !== null) checks.push({ name: 'pass-rule', passed: evaluated.passed })
      return {
        trialId: trial.trialId,
        // A benchmark assertion that fails is a result, not an infrastructure error.
        status: evaluated.passed === false ? 'failed' : 'passed',
        checks,
        artifacts: [],
        metadata: {
          ...metadataBase,
          evaluated: toJsonObject(evaluated),
          model: results[0]?.modelUsed ?? 'unspecified',
          operations: toJson(operationsFor(meta, calls, results, trial.attempt)),
          ...(detected === undefined ? {} : { detected: { baselineCached: detected['baselineCached'] ?? null, detectorConfigId: detected['detectorConfigId'] ?? null } }),
        },
      }
    },

    score(verification, targetResult): Promise<ScoredResult> {
      return Promise.resolve().then((): ScoredResult => {
        const testId = parseBenchmarkTestId(textOf(verification.metadata['testId']))
        const base = { trialId: verification.trialId, testId }
        if (verification.status === 'inconclusive') {
          return { ...base, value: {}, status: 'ERROR', metrics: {}, metadata: { scoring: SCORING_VERSION, reason: textOf(verification.metadata['reason']) } }
        }
        const evaluated = verification.metadata['evaluated'] as unknown as Evaluated
        const metrics: Record<string, number> = {}
        for (const name of ['latencyMs', 'roundTripMs', 'modelCalls', 'inputTokens', 'outputTokens', 'retryCount', 'callCount', 'appliedIntensity']) {
          const value = targetResult.metrics[name]
          if (value !== undefined) metrics[name] = value
        }
        const numeric = typeof evaluated.numeric === 'number' && Number.isFinite(evaluated.numeric) ? evaluated.numeric : undefined
        return {
          ...base,
          value: { ...(numeric === undefined ? {} : { numeric }), unit: evaluated.unit },
          status: statusOf(evaluated),
          metrics: metrics as MetricMap,
          metadata: {
            scoring: SCORING_VERSION,
            a2h: verification.metadata['a2h'] as JsonValue,
            measurement: evaluated.measurement,
            model: verification.metadata['model'] ?? 'unspecified',
            attempt: verification.metadata['attempt'] ?? 1,
            operations: verification.metadata['operations'] ?? [],
            ...(verification.metadata['detected'] === undefined ? {} : { detected: verification.metadata['detected'] }),
          },
        }
      })
    },

    async aggregate(results: readonly ScoredResult[], context: AggregationContext): Promise<AggregateResult> {
      const items = itemsOf(results)
      const errored = countBy(results, 'ERROR')
      const common = { scoring: SCORING_VERSION, packageVersion: options.version }

      if (context.testId !== undefined) {
        const def = defOf(context.testId)
        const mine = items.filter((i) => i.testId === def.code)
        if (def.design(options).pool === 'none' || mine.length === 0) {
          return { testId: context.testId, value: {}, status: 'NO_DATA', metrics: { errored }, sampleCount: results.length, metadata: { ...common, title: A2H_TEST_LABELS[def.code] } }
        }
        const parts = def.aggregate(mine)
        return {
          testId: context.testId,
          value: { ...(parts.numeric === null ? {} : { numeric: parts.numeric }), unit: parts.unit },
          status: parts.numeric === null ? 'NO_DATA' : 'MEASURED',
          metrics: { ...parts.metrics, scored: mine.length, errored },
          sampleCount: results.length,
          metadata: { ...common, title: A2H_TEST_LABELS[def.code], ...(parts.direction === undefined ? {} : { direction: parts.direction }), report: parts.report },
        }
      }

      if (context.categoryId !== undefined) {
        const byStatus: Record<string, number> = {}
        for (const r of results) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1
        return {
          value: {},
          status: results.length === 0 ? 'NO_DATA' : 'MEASURED',
          metrics: { scored: items.length, errored, pass: byStatus['PASS'] ?? 0, fail: byStatus['FAIL'] ?? 0, notEligible: byStatus['NOT_ELIGIBLE'] ?? 0 },
          sampleCount: results.length,
          metadata: { ...common, category: context.categoryId },
        }
      }

      // The whole batch: the roll-ups that have no trials of their own.
      const selected = new Set<string>(context.manifest.selection.testIds)
      const rollups: Record<string, JsonValue> = {}
      if (selected.has('A2H-03')) {
        const part = a2h03Rollup(items.filter((i) => i.testId === 'A2H-01'), items.filter((i) => i.testId === 'A2H-02'))
        rollups['A2H-03'] = { title: A2H_TEST_LABELS['A2H-03'], metrics: part.metrics, report: part.report }
      }
      if (selected.has('A2H-17')) {
        const part = a2h17Rollup(items.flatMap((i) => i.operations))
        rollups['A2H-17'] = { title: A2H_TEST_LABELS['A2H-17'], metrics: part.metrics, report: part.report }
      }
      const perTest: Record<string, number> = {}
      for (const item of items) perTest[`scored.${item.testId}`] = (perTest[`scored.${item.testId}`] ?? 0) + 1
      return {
        value: {},
        status: results.length === 0 ? 'NO_DATA' : 'MEASURED',
        metrics: { scored: items.length, errored, ...perTest },
        sampleCount: results.length,
        metadata: { ...common, rollups },
      }
    },
  }
}

function evalContext(trial: TrialSpec, meta: TrialMeta, results: readonly A2H15TargetResult[], runtime: BenchmarkRuntime | undefined): EvalContext {
  const calls = trial.parameters['calls'] as unknown as TargetCall[]
  const datasets = runtime?.datasets
  const index = () => {
    if (datasets === undefined || !datasets.has(FIXTURES_INPUT)) return Promise.reject(configError('The fixtures dataset is not bound'))
    return fixtureIndex(datasets)
  }
  return {
    trial,
    meta,
    results,
    sourceText: calls[0]?.text ?? '',
    runtime,
    fixtureIndex: index,
    async fixturesOfType(type) {
      return fixturesFor(await index(), meta.sourceId, type)
    },
    async fixture() {
      const key = str(meta['fixtureKey'])
      const found = key === undefined ? undefined : (await index()).byKey.get(key)
      if (found === undefined) throw new FrameworkError('VERIFIER_ERROR', 'The fixture for this trial is missing')
      return found
    },
  }
}

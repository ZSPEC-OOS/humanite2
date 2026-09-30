import type { Firestore } from 'firebase-admin/firestore'
import { getRun, listRunSources } from './runs'
import { getCorpusManifest } from './corpusProject'
import { getFixtureSet, listFixturesForSet } from './fixtures'
import { getSourceById } from './corpus'
import { listOutputsForRun } from './outputs'
import { listDetectorResultsForRun } from './baseline'
import { listTestResultsForRun } from './testResults'
import { listTrialsForRun } from './trials'
import { listRepairAttemptsForRun } from './repairAttempts'
import { collectOperationRecords } from './a2h17'
import { getReleaseForRun, computeAggregateSnapshot } from './release'

// Phase 5 export layer (§"Export layer"): a released benchmark should be
// independently analyzable as raw machine-readable data, not something
// only ever seen through this app's own admin pages. Every file here is
// derived straight from the same raw Firestore records the admin UI reads
// — nothing here is itself a source of truth, so regenerating these files
// twice from the same run always produces the same content. Available for
// ANY run (not gated on release) since an admin may want raw data mid-run
// too; the UI's own release workflow is what decides when a run's numbers
// are "final."
//
// Known gap: detector-results.csv is queried by THIS run's runId — a
// baseline a run REUSED from an earlier run (§8's cross-run baseline
// sharing) keeps that earlier run's runId as provenance, so it will be
// missing from a reusing run's own export even though its A2H-01/02
// measurements depend on it. Documented rather than silently incomplete.

export interface ExportFile {
  name: string
  contentType: 'application/json' | 'text/csv'
  content: string
}

function csvEscape(value: unknown): string {
  if (value == null) return ''
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function toCsv(rows: Array<Record<string, unknown>>, columns: string[]): string {
  const header = columns.join(',')
  const lines = rows.map(row => columns.map(col => csvEscape(row[col])).join(','))
  return [header, ...lines].join('\n')
}

// A run whose corpus/fixture-set/etc. is still live returns the CURRENT
// aggregate snapshot; a released run returns its FROZEN one (§"Result
// snapshotting") — a released run's exported summary.json must never drift
// even if a later code change alters how a report is computed.
async function summaryJson(firestore: Firestore, runId: string): Promise<Record<string, unknown>> {
  const release = await getReleaseForRun(firestore, runId)
  if (release) return release.aggregateSnapshot
  const run = (await getRun(firestore, runId))!
  return computeAggregateSnapshot(firestore, run)
}

export const EXPORT_FILE_NAMES = [
  'benchmark-release.json',
  'run-config.json',
  'corpus-manifest.json',
  'fixture-manifest.json',
  'summary.json',
  'sources.csv',
  'outputs.csv',
  'detector-results.csv',
  'test-results.csv',
  'trials.csv',
  'repair-attempts.csv',
  'operational-metrics.csv',
] as const

export type ExportFileName = (typeof EXPORT_FILE_NAMES)[number]

export async function buildExportFile(firestore: Firestore, runId: string, name: ExportFileName): Promise<ExportFile | null> {
  const run = await getRun(firestore, runId)
  if (!run) return null

  switch (name) {
    case 'benchmark-release.json': {
      const release = await getReleaseForRun(firestore, runId)
      return { name, contentType: 'application/json', content: JSON.stringify(release, null, 2) }
    }
    case 'run-config.json':
      return { name, contentType: 'application/json', content: JSON.stringify(run, null, 2) }
    case 'corpus-manifest.json': {
      const manifest = await getCorpusManifest(firestore, run.corpusProjectId)
      return { name, contentType: 'application/json', content: JSON.stringify(manifest, null, 2) }
    }
    case 'fixture-manifest.json': {
      if (!run.fixtureSetId) return { name, contentType: 'application/json', content: JSON.stringify(null, null, 2) }
      const [fixtureSet, fixtures] = await Promise.all([getFixtureSet(firestore, run.fixtureSetId), listFixturesForSet(firestore, run.fixtureSetId)])
      return { name, contentType: 'application/json', content: JSON.stringify({ fixtureSet, fixtures }, null, 2) }
    }
    case 'summary.json':
      return { name, contentType: 'application/json', content: JSON.stringify(await summaryJson(firestore, runId), null, 2) }

    case 'sources.csv': {
      const cohort = await listRunSources(firestore, runId)
      const sources = await Promise.all(cohort.map(row => getSourceById(firestore, row.sourceId)))
      const rows = sources.filter((s): s is NonNullable<typeof s> => s != null).map(s => ({ ...s, text: s.text.length })) // full text omitted from the tabular export — id/sha256 already make it independently verifiable against the corpus
      return { name, contentType: 'text/csv', content: toCsv(rows, ['id', 'corpusProjectId', 'domainId', 'topicId', 'targetWords', 'actualWords', 'generatorProvider', 'generatorModel', 'sha256', 'status', 'text']) }
    }
    case 'outputs.csv': {
      const outputs = await listOutputsForRun(firestore, runId)
      const rows = outputs.map(o => ({ ...o, outputText: o.outputText.length }))
      return { name, contentType: 'text/csv', content: toCsv(rows, ['id', 'sourceId', 'domainId', 'targetWords', 'intensity', 'outputWords', 'outputSha256', 'model', 'latencyMs', 'modelCalls', 'inputTokens', 'outputTokens', 'estimatedCostUsd', 'retryCount', 'candidateCount', 'status', 'errorCode', 'outputText']) }
    }
    case 'detector-results.csv': {
      const results = await listDetectorResultsForRun(firestore, runId)
      return { name, contentType: 'text/csv', content: toCsv(results as unknown as Array<Record<string, unknown>>, ['id', 'sourceId', 'outputId', 'stage', 'detector', 'detectorConfigId', 'aiProbability', 'humanProbability', 'mixedProbability', 'classification', 'latencyMs', 'analyzedAt']) }
    }
    case 'test-results.csv': {
      const results = await listTestResultsForRun(firestore, runId)
      const rows = results.map(r => ({ ...r, measurements: JSON.stringify(r.measurements) }))
      return { name, contentType: 'text/csv', content: toCsv(rows, ['id', 'sourceId', 'outputId', 'fixtureId', 'benchmarkCode', 'testVersion', 'passed', 'score', 'evaluatedAt', 'measurements']) }
    }
    case 'trials.csv': {
      const trials = await listTrialsForRun(firestore, runId)
      const rows = trials.map(t => ({ ...t, condition: JSON.stringify(t.condition), diagnostics: JSON.stringify(t.diagnostics) }))
      return { name, contentType: 'text/csv', content: toCsv(rows, ['id', 'benchmarkCode', 'sourceId', 'conditionId', 'trialIndex', 'model', 'latencyMs', 'modelCalls', 'inputTokens', 'outputTokens', 'aiProbability', 'classification', 'status', 'condition', 'diagnostics']) }
    }
    case 'repair-attempts.csv': {
      const attempts = await listRepairAttemptsForRun(firestore, runId)
      return { name, contentType: 'text/csv', content: toCsv(attempts as unknown as Array<Record<string, unknown>>, ['id', 'fixtureId', 'benchmarkCode', 'sourceId', 'model', 'latencyMs', 'modelCalls', 'inputTokens', 'outputTokens', 'status', 'attemptNumber']) }
    }
    case 'operational-metrics.csv': {
      const records = await collectOperationRecords(firestore, runId)
      return { name, contentType: 'text/csv', content: toCsv(records as unknown as Array<Record<string, unknown>>, ['operation', 'benchmarkCode', 'domainId', 'targetWords', 'intensity', 'model', 'latencyMs', 'inputTokens', 'outputTokens', 'modelCalls', 'retryCount', 'estimatedCostUsd', 'status', 'timedOut']) }
    }
  }
}

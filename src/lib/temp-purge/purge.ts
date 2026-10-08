/**
 * TEMPORARY. One-off removal of leftover benchmark data from Firestore, triggered from a button on the
 * homepage. Delete this folder, src/app/api/temp-purge and the button when the purge is done.
 *
 * By the owner's choice there is NO token and NO confirmation: anyone who can reach the homepage can run it.
 * The only limit is the fixed collection list below, so nothing else can be touched.
 */
export const PURGE_COLLECTIONS = [
  'a2hCorpusProjects', 'a2hTopics', 'a2hCorpusSources', 'a2hDetectorResults', 'a2hBenchmarkOutputs',
  'a2hCorpusManifests', 'a2hBenchmarkRuns', 'a2hBenchmarkRunSources', 'a2hBenchmarkJobs',
  'a2hBenchmarkTestResults', 'a2hFixtureSets', 'a2hBenchmarkFixtures', 'a2hBenchmarkRepairAttempts',
  'a2hBenchmarkTrials', 'a2hBenchmarkExperimentCohorts', 'a2hBenchmarkReleases',
] as const

export type PurgeRequest = { action: unknown; collection?: unknown }
export type PurgeDecision =
  | { ok: true; action: 'count' | 'delete'; collection?: string }
  | { ok: false; status: 400; message: string }

export function decidePurge(body: PurgeRequest): PurgeDecision {
  if (body.action === 'count') return { ok: true, action: 'count' }
  if (body.action === 'delete') {
    if (typeof body.collection !== 'string' || !(PURGE_COLLECTIONS as readonly string[]).includes(body.collection)) {
      return { ok: false, status: 400, message: 'Unknown collection.' }
    }
    return { ok: true, action: 'delete', collection: body.collection }
  }
  return { ok: false, status: 400, message: 'Unknown action.' }
}

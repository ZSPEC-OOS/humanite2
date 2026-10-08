/**
 * TEMPORARY. One-off removal of leftover benchmark data from Firestore, triggered from a button on the
 * homepage. Delete this folder, src/app/api/temp-purge and the button when the purge is done.
 *
 * SAFETY: the route is OFF (404) unless TEMP_PURGE_TOKEN is set to a secret of at least 16 characters, every
 * request must present that token (constant-time compare), and only the fixed collections below can be touched.
 */
import { createHash, timingSafeEqual } from 'crypto'

export const PURGE_COLLECTIONS = [
  'a2hCorpusProjects', 'a2hTopics', 'a2hCorpusSources', 'a2hDetectorResults', 'a2hBenchmarkOutputs',
  'a2hCorpusManifests', 'a2hBenchmarkRuns', 'a2hBenchmarkRunSources', 'a2hBenchmarkJobs',
  'a2hBenchmarkTestResults', 'a2hFixtureSets', 'a2hBenchmarkFixtures', 'a2hBenchmarkRepairAttempts',
  'a2hBenchmarkTrials', 'a2hBenchmarkExperimentCohorts', 'a2hBenchmarkReleases',
] as const

export const MIN_PURGE_TOKEN_LENGTH = 16

export type PurgeRequest = { token: unknown; action: unknown; collection?: unknown }
export type PurgeDecision =
  | { ok: true; action: 'count' | 'delete'; collection?: string }
  | { ok: false; status: 400 | 401 | 404; message: string }

const digest = (v: string) => createHash('sha256').update(v, 'utf8').digest()

export function decidePurge(body: PurgeRequest, configuredToken: string | undefined): PurgeDecision {
  if (!configuredToken || configuredToken.length < MIN_PURGE_TOKEN_LENGTH) return { ok: false, status: 404, message: 'Not found.' }
  if (typeof body.token !== 'string' || !timingSafeEqual(digest(body.token), digest(configuredToken))) {
    return { ok: false, status: 401, message: 'Wrong token.' }
  }
  if (body.action === 'count') return { ok: true, action: 'count' }
  if (body.action === 'delete') {
    if (typeof body.collection !== 'string' || !(PURGE_COLLECTIONS as readonly string[]).includes(body.collection)) {
      return { ok: false, status: 400, message: 'Unknown collection.' }
    }
    return { ok: true, action: 'delete', collection: body.collection }
  }
  return { ok: false, status: 400, message: 'Unknown action.' }
}

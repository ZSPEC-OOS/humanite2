import { apiFetch } from '@/lib/api'
import type {
  BenchmarkTopic, CorpusSource, BenchmarkOutput, CorpusProject, CorpusManifest, DetectorResult,
  BenchmarkRun, BenchmarkRunSource,
} from '@/lib/a2h/types'
import type { CreateTopicInput } from '@/lib/a2h/topics'
import type { ProjectDraftPatch, FreezeValidationResult } from '@/lib/a2h/corpusProject'
import type { RunDraftPatch, RunValidationResult, RunProgress } from '@/lib/a2h/runs'
import type { ExecuteBatchResult } from '@/lib/a2h/execution'
import type { A2H01Report, A2H01Filters } from '@/lib/a2h/a2h01'
import type { A2H02Report, A2H02Filters } from '@/lib/a2h/a2h02'
import type { A2H03Report, A2H03Filters, A2H03Stratum } from '@/lib/a2h/a2h03'
import type { OutputDetail } from '@/lib/a2h/outputDetail'
import type { Domain } from '@/lib/style/types'

export type {
  BenchmarkTopic, CorpusSource, BenchmarkOutput, CreateTopicInput, DetectorResult, CorpusProject, ProjectDraftPatch, CorpusManifest, FreezeValidationResult,
  BenchmarkRun, BenchmarkRunSource, RunDraftPatch, RunValidationResult, RunProgress, ExecuteBatchResult,
  A2H01Report, A2H01Filters, A2H02Report, A2H02Filters, A2H03Report, A2H03Filters, A2H03Stratum, OutputDetail,
}

// ── Corpus projects ──────────────────────────────────────────────────────

export async function apiListProjects(): Promise<CorpusProject[]> {
  const data = await apiFetch<{ projects: CorpusProject[] }>('/admin/a2h/projects')
  return data.projects
}

export async function apiGetProject(projectId: string): Promise<CorpusProject> {
  const data = await apiFetch<{ project: CorpusProject }>(`/admin/a2h/projects/${projectId}`)
  return data.project
}

export async function apiCreateProject(name: string, benchmarkVersion?: string, corpusVersion?: string): Promise<CorpusProject> {
  const data = await apiFetch<{ project: CorpusProject }>('/admin/a2h/projects', {
    method: 'POST',
    body: JSON.stringify({ name, benchmarkVersion, corpusVersion }),
  })
  return data.project
}

export async function apiUpdateProjectDraft(projectId: string, patch: ProjectDraftPatch): Promise<CorpusProject> {
  const data = await apiFetch<{ project: CorpusProject }>(`/admin/a2h/projects/${projectId}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
  return data.project
}

export async function apiLockBlueprint(projectId: string): Promise<CorpusProject> {
  const data = await apiFetch<{ project: CorpusProject }>(`/admin/a2h/projects/${projectId}/lock-blueprint`, { method: 'POST' })
  return data.project
}

export async function apiFreezeProject(projectId: string): Promise<CorpusProject> {
  const data = await apiFetch<{ project: CorpusProject }>(`/admin/a2h/projects/${projectId}/freeze`, { method: 'POST' })
  return data.project
}

export async function apiArchiveProject(projectId: string): Promise<CorpusProject> {
  const data = await apiFetch<{ project: CorpusProject }>(`/admin/a2h/projects/${projectId}/archive`, { method: 'POST' })
  return data.project
}

// Irreversible — cascades to every topic/source/run/result scoped to this
// project. confirmName must exactly match the project's current name; the
// server re-checks this independently of whatever UI confirmation gated
// the call.
export async function apiDeleteProject(projectId: string, confirmName: string): Promise<void> {
  await apiFetch<{ deleted: true }>(`/admin/a2h/projects/${projectId}`, {
    method: 'DELETE',
    body: JSON.stringify({ confirmName }),
  })
}

export async function apiDuplicateProject(projectId: string, name: string): Promise<CorpusProject> {
  const data = await apiFetch<{ project: CorpusProject }>(`/admin/a2h/projects/${projectId}/duplicate`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
  return data.project
}

export async function apiFreezeCheck(projectId: string): Promise<FreezeValidationResult> {
  const data = await apiFetch<{ validation: FreezeValidationResult }>(`/admin/a2h/projects/${projectId}/freeze-check`)
  return data.validation
}

export async function apiGetManifest(projectId: string): Promise<CorpusManifest | null> {
  try {
    const data = await apiFetch<{ manifest: CorpusManifest }>(`/admin/a2h/projects/${projectId}/manifest`)
    return data.manifest
  } catch {
    return null
  }
}

// ── Topics (blueprint) ───────────────────────────────────────────────────

export async function apiListTopics(corpusProjectId: string, domainId?: Domain): Promise<BenchmarkTopic[]> {
  const params = new URLSearchParams({ corpusProjectId })
  if (domainId) params.set('domainId', domainId)
  const data = await apiFetch<{ topics: BenchmarkTopic[] }>(`/admin/a2h/topics?${params.toString()}`)
  return data.topics
}

export async function apiCreateTopic(input: CreateTopicInput): Promise<BenchmarkTopic> {
  const data = await apiFetch<{ topic: BenchmarkTopic }>('/admin/a2h/topics', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return data.topic
}

export async function apiUpdateTopic(topicId: string, patch: Partial<BenchmarkTopic>): Promise<BenchmarkTopic> {
  const data = await apiFetch<{ topic: BenchmarkTopic }>(`/admin/a2h/topics/${topicId}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
  return data.topic
}

export async function apiGenerateOutline(corpusProjectId: string, domainId: Domain, force = false): Promise<BenchmarkTopic[]> {
  const data = await apiFetch<{ topics: BenchmarkTopic[] }>('/admin/a2h/topics/generate-outline', {
    method: 'POST',
    body: JSON.stringify({ corpusProjectId, domainId, force }),
  })
  return data.topics
}

export async function apiExpandOutline(corpusProjectId: string, domainId: Domain): Promise<BenchmarkTopic[]> {
  const data = await apiFetch<{ topics: BenchmarkTopic[] }>('/admin/a2h/topics/expand-outline', {
    method: 'POST',
    body: JSON.stringify({ corpusProjectId, domainId }),
  })
  return data.topics
}

// ── Corpus sources ───────────────────────────────────────────────────────

export async function apiListCorpus(corpusProjectId: string, domainId?: Domain): Promise<CorpusSource[]> {
  const params = new URLSearchParams({ corpusProjectId })
  if (domainId) params.set('domainId', domainId)
  const data = await apiFetch<{ sources: CorpusSource[] }>(`/admin/a2h/corpus?${params.toString()}`)
  return data.sources
}

export async function apiGenerateSource(corpusProjectId: string, topicId: string, targetWords: number, force = false): Promise<CorpusSource> {
  const data = await apiFetch<{ source: CorpusSource }>('/admin/a2h/corpus/generate', {
    method: 'POST',
    body: JSON.stringify({ corpusProjectId, topicId, targetWords, force }),
  })
  return data.source
}

export async function apiFreezeSource(corpusProjectId: string, topicId: string, targetWords: number): Promise<CorpusSource> {
  const data = await apiFetch<{ source: CorpusSource }>('/admin/a2h/corpus/freeze', {
    method: 'POST',
    body: JSON.stringify({ corpusProjectId, topicId, targetWords }),
  })
  return data.source
}

// ── Benchmark runs ───────────────────────────────────────────────────────
// Baseline/transform/post-score acquisition are no longer driven per-cell
// from the client — they run inside the run engine's checkpointed job
// pipeline (see src/lib/a2h/execution.ts) via apiExecuteRunBatch.

export async function apiListRuns(corpusProjectId: string): Promise<BenchmarkRun[]> {
  const data = await apiFetch<{ runs: BenchmarkRun[] }>(`/admin/a2h/runs?corpusProjectId=${corpusProjectId}`)
  return data.runs
}

export async function apiGetRun(runId: string): Promise<BenchmarkRun> {
  const data = await apiFetch<{ run: BenchmarkRun }>(`/admin/a2h/runs/${runId}`)
  return data.run
}

export interface CreateRunBody {
  corpusProjectId: string
  name: string
  // Omitted client-side to let the server snapshot the admin's own
  // currently-configured model/provider at creation time (see the route).
  modelProvider?: string
  model?: string
  detectorConfigId?: string
  concurrency?: number
}

export async function apiCreateRun(body: CreateRunBody): Promise<BenchmarkRun> {
  const data = await apiFetch<{ run: BenchmarkRun }>('/admin/a2h/runs', { method: 'POST', body: JSON.stringify(body) })
  return data.run
}

export async function apiUpdateRunDraft(runId: string, patch: RunDraftPatch): Promise<BenchmarkRun> {
  const data = await apiFetch<{ run: BenchmarkRun }>(`/admin/a2h/runs/${runId}`, { method: 'PATCH', body: JSON.stringify(patch) })
  return data.run
}

export async function apiValidateRun(runId: string): Promise<{ run: BenchmarkRun; result: RunValidationResult }> {
  return apiFetch<{ run: BenchmarkRun; result: RunValidationResult }>(`/admin/a2h/runs/${runId}/validate`, { method: 'POST' })
}

export async function apiStartRun(runId: string): Promise<BenchmarkRun> {
  const data = await apiFetch<{ run: BenchmarkRun }>(`/admin/a2h/runs/${runId}/start`, { method: 'POST' })
  return data.run
}

export async function apiPauseRun(runId: string): Promise<BenchmarkRun> {
  const data = await apiFetch<{ run: BenchmarkRun }>(`/admin/a2h/runs/${runId}/pause`, { method: 'POST' })
  return data.run
}

export async function apiResumeRun(runId: string): Promise<BenchmarkRun> {
  const data = await apiFetch<{ run: BenchmarkRun }>(`/admin/a2h/runs/${runId}/resume`, { method: 'POST' })
  return data.run
}

export async function apiCancelRun(runId: string): Promise<BenchmarkRun> {
  const data = await apiFetch<{ run: BenchmarkRun }>(`/admin/a2h/runs/${runId}/cancel`, { method: 'POST' })
  return data.run
}

export async function apiGetRunProgress(runId: string): Promise<RunProgress> {
  const data = await apiFetch<{ progress: RunProgress }>(`/admin/a2h/runs/${runId}/progress`)
  return data.progress
}

export async function apiListRunSources(runId: string): Promise<BenchmarkRunSource[]> {
  const data = await apiFetch<{ sources: BenchmarkRunSource[] }>(`/admin/a2h/runs/${runId}/sources`)
  return data.sources
}

// Advances one bounded batch of the run's queued work — call this
// repeatedly (the UI loops it) until run.status is no longer 'running'.
export async function apiExecuteRunBatch(runId: string): Promise<ExecuteBatchResult> {
  return apiFetch<ExecuteBatchResult>(`/admin/a2h/runs/${runId}/execute`, { method: 'POST' })
}

// ── A2H test results ─────────────────────────────────────────────────────

function toQuery(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) if (value !== undefined) search.set(key, String(value))
  const qs = search.toString()
  return qs ? `?${qs}` : ''
}

export async function apiGetA2H01Report(runId: string, filters?: A2H01Filters): Promise<A2H01Report> {
  const qs = toQuery({ ...filters })
  return apiFetch<A2H01Report>(`/admin/a2h/runs/${runId}/tests/a2h-01${qs}`)
}

export async function apiGetA2H02Report(runId: string, filters?: A2H02Filters): Promise<A2H02Report> {
  const qs = toQuery({ ...filters })
  return apiFetch<A2H02Report>(`/admin/a2h/runs/${runId}/tests/a2h-02${qs}`)
}

export async function apiGetA2H03Report(runId: string, filters?: A2H03Filters, stratifyBy?: A2H03Stratum): Promise<A2H03Report> {
  const qs = toQuery({ ...filters, stratifyBy })
  return apiFetch<A2H03Report>(`/admin/a2h/runs/${runId}/tests/a2h-03${qs}`)
}

export async function apiGetOutputDetail(runId: string, outputId: string): Promise<OutputDetail> {
  const data = await apiFetch<{ detail: OutputDetail }>(`/admin/a2h/runs/${runId}/outputs/${outputId}`)
  return data.detail
}

import { apiFetch } from '@/lib/api'
import type { BenchmarkTopic, CorpusSource, BenchmarkOutput, CorpusProject, CorpusManifest } from '@/lib/a2h/types'
import type { CreateTopicInput } from '@/lib/a2h/topics'
import type { ProjectDraftPatch, FreezeValidationResult } from '@/lib/a2h/corpusProject'
import type { DetectorResult } from '@/lib/a2h/baseline'
import type { Domain } from '@/lib/style/types'

export type { BenchmarkTopic, CorpusSource, BenchmarkOutput, CreateTopicInput, DetectorResult, CorpusProject, ProjectDraftPatch, CorpusManifest, FreezeValidationResult }

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

// ── Detector baselines / post-scores ─────────────────────────────────────

export async function apiListBaselines(corpusProjectId: string, domainId?: Domain): Promise<Record<string, DetectorResult>> {
  const params = new URLSearchParams({ corpusProjectId })
  if (domainId) params.set('domainId', domainId)
  const data = await apiFetch<{ baselines: Record<string, DetectorResult> }>(`/admin/a2h/corpus/baseline?${params.toString()}`)
  return data.baselines
}

export async function apiAcquireBaseline(corpusProjectId: string, topicId: string, targetWords: number, force = false): Promise<DetectorResult> {
  const data = await apiFetch<{ baseline: DetectorResult }>('/admin/a2h/corpus/baseline', {
    method: 'POST',
    body: JSON.stringify({ corpusProjectId, topicId, targetWords, force }),
  })
  return data.baseline
}

export async function apiListPostScores(corpusProjectId: string, topicId: string, targetWords: number): Promise<Record<string, DetectorResult>> {
  const params = new URLSearchParams({ corpusProjectId, topicId, targetWords: String(targetWords) })
  const data = await apiFetch<{ postScores: Record<string, DetectorResult> }>(`/admin/a2h/corpus/post-score?${params.toString()}`)
  return data.postScores
}

export async function apiAcquirePostScore(corpusProjectId: string, topicId: string, targetWords: number, intensity: number, force = false): Promise<DetectorResult> {
  const data = await apiFetch<{ postScore: DetectorResult }>('/admin/a2h/corpus/post-score', {
    method: 'POST',
    body: JSON.stringify({ corpusProjectId, topicId, targetWords, intensity, force }),
  })
  return data.postScore
}

// ── Humanite outputs ─────────────────────────────────────────────────────

export async function apiListOutputs(corpusProjectId: string, topicId: string, targetWords: number): Promise<BenchmarkOutput[]> {
  const params = new URLSearchParams({ corpusProjectId, topicId, targetWords: String(targetWords) })
  const data = await apiFetch<{ outputs: BenchmarkOutput[] }>(`/admin/a2h/corpus/transform?${params.toString()}`)
  return data.outputs
}

export async function apiTransformSource(corpusProjectId: string, topicId: string, targetWords: number, intensity: number, force = false): Promise<BenchmarkOutput> {
  const data = await apiFetch<{ output: BenchmarkOutput }>('/admin/a2h/corpus/transform', {
    method: 'POST',
    body: JSON.stringify({ corpusProjectId, topicId, targetWords, intensity, force }),
  })
  return data.output
}

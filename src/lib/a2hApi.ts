import { apiFetch } from '@/lib/api'
import type { BenchmarkTopic, CorpusSource, BenchmarkOutput, DomainOutlineConfig } from '@/lib/a2h/types'
import type { CreateTopicInput } from '@/lib/a2h/topics'
import type { DetectorResult } from '@/lib/a2h/baseline'
import type { Domain } from '@/lib/style/types'

export type { BenchmarkTopic, CorpusSource, BenchmarkOutput, CreateTopicInput, DetectorResult, DomainOutlineConfig }

export async function apiListTopics(domainId?: Domain): Promise<BenchmarkTopic[]> {
  const qs = domainId ? `?domainId=${domainId}` : ''
  const data = await apiFetch<{ topics: BenchmarkTopic[] }>(`/admin/a2h/topics${qs}`)
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

export async function apiListCorpus(domainId?: Domain, corpusVersion?: string): Promise<CorpusSource[]> {
  const params = new URLSearchParams()
  if (domainId) params.set('domainId', domainId)
  if (corpusVersion) params.set('corpusVersion', corpusVersion)
  const qs = params.toString() ? `?${params.toString()}` : ''
  const data = await apiFetch<{ sources: CorpusSource[] }>(`/admin/a2h/corpus${qs}`)
  return data.sources
}

export async function apiGenerateSource(topicId: string, targetWords: number, force = false): Promise<CorpusSource> {
  const data = await apiFetch<{ source: CorpusSource }>('/admin/a2h/corpus/generate', {
    method: 'POST',
    body: JSON.stringify({ topicId, targetWords, force }),
  })
  return data.source
}

export async function apiFreezeSource(topicId: string, targetWords: number): Promise<CorpusSource> {
  const data = await apiFetch<{ source: CorpusSource }>('/admin/a2h/corpus/freeze', {
    method: 'POST',
    body: JSON.stringify({ topicId, targetWords }),
  })
  return data.source
}

export async function apiListBaselines(domainId?: Domain, corpusVersion?: string): Promise<Record<string, DetectorResult>> {
  const params = new URLSearchParams()
  if (domainId) params.set('domainId', domainId)
  if (corpusVersion) params.set('corpusVersion', corpusVersion)
  const qs = params.toString() ? `?${params.toString()}` : ''
  const data = await apiFetch<{ baselines: Record<string, DetectorResult> }>(`/admin/a2h/corpus/baseline${qs}`)
  return data.baselines
}

export async function apiAcquireBaseline(topicId: string, targetWords: number, force = false): Promise<DetectorResult> {
  const data = await apiFetch<{ baseline: DetectorResult }>('/admin/a2h/corpus/baseline', {
    method: 'POST',
    body: JSON.stringify({ topicId, targetWords, force }),
  })
  return data.baseline
}

export async function apiGetDomainConfig(domainId: Domain): Promise<DomainOutlineConfig | null> {
  const data = await apiFetch<{ config: DomainOutlineConfig | null }>(`/admin/a2h/domains/${domainId}`)
  return data.config
}

export async function apiSaveDomainTopicCount(domainId: Domain, topicCount: number): Promise<DomainOutlineConfig> {
  const data = await apiFetch<{ config: DomainOutlineConfig }>(`/admin/a2h/domains/${domainId}`, {
    method: 'PATCH',
    body: JSON.stringify({ action: 'save', topicCount }),
  })
  return data.config
}

export async function apiLockDomain(domainId: Domain, topicCount?: number): Promise<DomainOutlineConfig> {
  const data = await apiFetch<{ config: DomainOutlineConfig }>(`/admin/a2h/domains/${domainId}`, {
    method: 'PATCH',
    body: JSON.stringify({ action: 'lock', topicCount }),
  })
  return data.config
}

export async function apiUnlockDomain(domainId: Domain): Promise<DomainOutlineConfig> {
  const data = await apiFetch<{ config: DomainOutlineConfig }>(`/admin/a2h/domains/${domainId}`, {
    method: 'PATCH',
    body: JSON.stringify({ action: 'unlock' }),
  })
  return data.config
}

export async function apiGenerateOutline(domainId: Domain, force = false): Promise<BenchmarkTopic[]> {
  const data = await apiFetch<{ topics: BenchmarkTopic[] }>('/admin/a2h/topics/generate-outline', {
    method: 'POST',
    body: JSON.stringify({ domainId, force }),
  })
  return data.topics
}

export async function apiListOutputs(topicId: string, targetWords: number, corpusVersion?: string): Promise<BenchmarkOutput[]> {
  const params = new URLSearchParams({ topicId, targetWords: String(targetWords) })
  if (corpusVersion) params.set('corpusVersion', corpusVersion)
  const data = await apiFetch<{ outputs: BenchmarkOutput[] }>(`/admin/a2h/corpus/transform?${params.toString()}`)
  return data.outputs
}

export async function apiTransformSource(topicId: string, targetWords: number, intensity: number, force = false): Promise<BenchmarkOutput> {
  const data = await apiFetch<{ output: BenchmarkOutput }>('/admin/a2h/corpus/transform', {
    method: 'POST',
    body: JSON.stringify({ topicId, targetWords, intensity, force }),
  })
  return data.output
}

export async function apiListPostScores(topicId: string, targetWords: number, corpusVersion?: string): Promise<Record<string, DetectorResult>> {
  const params = new URLSearchParams({ topicId, targetWords: String(targetWords) })
  if (corpusVersion) params.set('corpusVersion', corpusVersion)
  const data = await apiFetch<{ postScores: Record<string, DetectorResult> }>(`/admin/a2h/corpus/post-score?${params.toString()}`)
  return data.postScores
}

export async function apiAcquirePostScore(topicId: string, targetWords: number, intensity: number, force = false): Promise<DetectorResult> {
  const data = await apiFetch<{ postScore: DetectorResult }>('/admin/a2h/corpus/post-score', {
    method: 'POST',
    body: JSON.stringify({ topicId, targetWords, intensity, force }),
  })
  return data.postScore
}

import { apiFetch } from '@/lib/api'
import type { BenchmarkTopic, CorpusSource } from '@/lib/a2h/types'
import type { CreateTopicInput } from '@/lib/a2h/topics'
import type { Domain } from '@/lib/style/types'

export type { BenchmarkTopic, CorpusSource, CreateTopicInput }

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

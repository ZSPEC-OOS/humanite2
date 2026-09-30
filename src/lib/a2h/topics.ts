import type { Firestore, Query, DocumentData } from 'firebase-admin/firestore'
import { DOMAINS, type Domain } from '@/lib/style/types'
import { MAX_TOPICS_PER_DOMAIN, type BenchmarkTopic } from './types'

const COLLECTION = 'a2hTopics'

export type CreateTopicInput = Omit<BenchmarkTopic, 'id' | 'enabled' | 'createdAt' | 'updatedAt'>

// Parses and validates a topic-outline submission from the admin form/import
// — the human-curated content this module exists to store, never generated
// by this codebase. Kept separate from the API route so it's testable
// without an HTTP request or a Firestore instance.
export function parseTopicInput(body: Record<string, unknown>): { input: CreateTopicInput } | { error: string } {
  const domainId = body.domainId
  if (typeof domainId !== 'string' || !DOMAINS.includes(domainId as Domain)) {
    return { error: `domainId must be one of: ${DOMAINS.join(', ')}` }
  }
  const topicNumber = Number(body.topicNumber)
  if (!Number.isInteger(topicNumber) || topicNumber < 1 || topicNumber > MAX_TOPICS_PER_DOMAIN) {
    return { error: `topicNumber must be an integer between 1 and ${MAX_TOPICS_PER_DOMAIN}` }
  }
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (!title) return { error: 'title is required' }
  const description = typeof body.description === 'string' ? body.description.trim() : ''
  if (!description) return { error: 'description is required' }
  const intendedAudience = typeof body.intendedAudience === 'string' ? body.intendedAudience.trim() : ''
  if (!intendedAudience) return { error: 'intendedAudience is required' }
  const writingType = typeof body.writingType === 'string' ? body.writingType.trim() : ''
  if (!writingType) return { error: 'writingType is required' }
  const coreConcepts = Array.isArray(body.coreConcepts)
    ? body.coreConcepts.filter((c): c is string => typeof c === 'string' && c.trim().length > 0).map(c => c.trim())
    : []
  if (coreConcepts.length === 0) return { error: 'coreConcepts must include at least one entry' }
  const generationPromptVersion = typeof body.generationPromptVersion === 'string' ? body.generationPromptVersion.trim() : ''
  if (!generationPromptVersion) return { error: 'generationPromptVersion is required' }

  return {
    input: {
      domainId: domainId as Domain,
      topicNumber,
      title,
      description,
      intendedAudience,
      writingType,
      coreConcepts,
      generationPromptVersion,
    },
  }
}

export async function listTopics(firestore: Firestore, domainId?: Domain): Promise<BenchmarkTopic[]> {
  let query: Query<DocumentData> = firestore.collection(COLLECTION)
  if (domainId) query = query.where('domainId', '==', domainId)
  const snap = await query.get()
  return snap.docs
    .map(d => d.data() as BenchmarkTopic)
    .sort((a, b) => a.domainId.localeCompare(b.domainId) || a.topicNumber - b.topicNumber)
}

export async function getTopic(firestore: Firestore, topicId: string): Promise<BenchmarkTopic | null> {
  const doc = await firestore.collection(COLLECTION).doc(topicId).get()
  return doc.exists ? (doc.data() as BenchmarkTopic) : null
}

export async function createTopic(firestore: Firestore, input: CreateTopicInput): Promise<BenchmarkTopic> {
  const now = new Date().toISOString()
  const ref = firestore.collection(COLLECTION).doc()
  const topic: BenchmarkTopic = { id: ref.id, ...input, enabled: true, createdAt: now, updatedAt: now }
  await ref.set(topic)
  return topic
}

export type TopicPatch = Partial<
  Pick<BenchmarkTopic, 'title' | 'description' | 'intendedAudience' | 'writingType' | 'coreConcepts' | 'generationPromptVersion' | 'enabled'>
>

export function parseTopicPatch(body: Record<string, unknown>): TopicPatch {
  const patch: TopicPatch = {}
  if (typeof body.title === 'string') patch.title = body.title.trim()
  if (typeof body.description === 'string') patch.description = body.description.trim()
  if (typeof body.intendedAudience === 'string') patch.intendedAudience = body.intendedAudience.trim()
  if (typeof body.writingType === 'string') patch.writingType = body.writingType.trim()
  if (Array.isArray(body.coreConcepts)) {
    patch.coreConcepts = body.coreConcepts.filter((c): c is string => typeof c === 'string' && c.trim().length > 0).map(c => c.trim())
  }
  if (typeof body.generationPromptVersion === 'string') patch.generationPromptVersion = body.generationPromptVersion.trim()
  if (typeof body.enabled === 'boolean') patch.enabled = body.enabled
  return patch
}

export async function updateTopic(firestore: Firestore, topicId: string, patch: TopicPatch): Promise<void> {
  await firestore.collection(COLLECTION).doc(topicId).update({ ...patch, updatedAt: new Date().toISOString() })
}

// Used only by outline regeneration (generateOutline's forceOverwrite path)
// to clear a domain's roster before writing a fresh one — never exposed as
// its own "delete all" admin action.
export async function deleteTopicsForDomain(firestore: Firestore, domainId: Domain): Promise<void> {
  const existing = await listTopics(firestore, domainId)
  await Promise.all(existing.map(t => firestore.collection(COLLECTION).doc(t.id).delete()))
}

import type { Firestore } from 'firebase-admin/firestore'
import { getCorpusProject } from './corpusProject'
import { listTopics, createTopic, updateTopic, getTopic, type CreateTopicInput, type TopicPatch } from './topics'
import { normalizeTopicTitle } from './textNormalize'
import type { BenchmarkTopic } from './types'

// A separate module (rather than living in topics.ts or corpusProject.ts)
// specifically to avoid a circular import: corpusProject.ts already imports
// listTopics/createTopic from topics.ts, so topics.ts importing
// getCorpusProject back from corpusProject.ts would create a cycle. This
// module is free to depend on both.

// Full manual-creation guard, run before a topic the admin typed in by hand
// is allowed to exist: the project must be real and still draft, the domain
// must actually be selected, the topic number must fit the domain's
// configured count and not collide with an existing one, and the title must
// not duplicate an existing title in the same domain once normalized
// (case/punctuation/whitespace-insensitive) — "Hypertension", "hypertension",
// and "Hypertension." are the same topic as far as the blueprint is
// concerned. Manual creation goes through the exact same duplicate-title
// rule generateOutline/expandOutline already enforce for generated topics.
export async function createTopicChecked(
  firestore: Firestore,
  corpusProjectId: string,
  input: Omit<CreateTopicInput, 'corpusProjectId'>,
): Promise<BenchmarkTopic> {
  const project = await getCorpusProject(firestore, corpusProjectId)
  if (!project) throw new Error('Corpus project not found.')
  if (project.status !== 'draft') {
    throw new Error(`Cannot add a topic — project is ${project.status}, not draft.`)
  }
  if (!project.domains.includes(input.domainId)) {
    throw new Error(`${input.domainId} is not a selected domain for this project.`)
  }
  const configured = project.topicCountByDomain[input.domainId]
  if (!configured || input.topicNumber > configured) {
    throw new Error(`topicNumber must be between 1 and ${configured ?? 0} for ${input.domainId}.`)
  }

  const siblings = await listTopics(firestore, corpusProjectId, input.domainId)
  if (siblings.some(t => t.topicNumber === input.topicNumber)) {
    throw new Error(`Topic number ${input.topicNumber} is already used in ${input.domainId}.`)
  }
  const normalized = normalizeTopicTitle(input.title)
  if (siblings.some(t => normalizeTopicTitle(t.title) === normalized)) {
    throw new Error(`A topic titled "${input.title}" already exists in ${input.domainId}.`)
  }

  return createTopic(firestore, { ...input, corpusProjectId })
}

// The current PATCH route must not update a topic merely because its id
// exists — its parent project must still be draft (once the blueprint is
// locked, every topic field is immutable: title, description, audience,
// writing type, core concepts, enabled state, generation prompt version),
// and a title change must not introduce a normalized duplicate against a
// sibling topic in the same domain.
export async function updateTopicChecked(firestore: Firestore, topicId: string, patch: TopicPatch): Promise<BenchmarkTopic> {
  const topic = await getTopic(firestore, topicId)
  if (!topic) throw new Error('Topic not found.')
  const project = await getCorpusProject(firestore, topic.corpusProjectId)
  if (!project) throw new Error('Corpus project not found.')
  if (project.status !== 'draft') {
    throw new Error(`Cannot edit a topic — project is ${project.status}, not draft. Topics are immutable once the blueprint is locked.`)
  }

  if (patch.title !== undefined) {
    const normalized = normalizeTopicTitle(patch.title)
    const siblings = await listTopics(firestore, topic.corpusProjectId, topic.domainId)
    if (siblings.some(t => t.id !== topic.id && normalizeTopicTitle(t.title) === normalized)) {
      throw new Error(`A topic titled "${patch.title}" already exists in ${topic.domainId}.`)
    }
  }

  await updateTopic(firestore, topicId, patch)
  const updated = await getTopic(firestore, topicId)
  if (!updated) throw new Error('Topic not found after update.')
  return updated
}

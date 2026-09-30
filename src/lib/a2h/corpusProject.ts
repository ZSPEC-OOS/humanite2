import type { Firestore } from 'firebase-admin/firestore'
import { DOMAINS, type Domain } from '@/lib/style/types'
import {
  DEFAULT_CORPUS_VERSION, DEFAULT_BENCHMARK_VERSION, DEFAULT_INTENSITIES, MAX_TOPICS_PER_DOMAIN,
  type CorpusProject,
} from './types'
import { listTopics, createTopic } from './topics'

const COLLECTION = 'a2hCorpusProjects'

export function validateProjectName(name: unknown): string | null {
  if (typeof name !== 'string' || !name.trim()) return 'name is required'
  if (name.trim().length > 200) return 'name must be 200 characters or fewer'
  return null
}

export function validateDomains(domains: unknown): { domains: Domain[] } | { error: string } {
  if (!Array.isArray(domains) || domains.length === 0) {
    return { error: 'Select at least one domain.' }
  }
  const invalid = domains.find(d => !(DOMAINS as readonly string[]).includes(d))
  if (invalid !== undefined) {
    return { error: `domains must only contain: ${DOMAINS.join(', ')}` }
  }
  return { domains: [...new Set(domains as Domain[])] }
}

export function validateTopicCountByDomain(
  value: unknown,
  domains: Domain[],
): { topicCountByDomain: Partial<Record<Domain, number>> } | { error: string } {
  if (typeof value !== 'object' || value === null) {
    return { error: 'topicCountByDomain must be an object.' }
  }
  const result: Partial<Record<Domain, number>> = {}
  for (const d of domains) {
    const n = Number((value as Record<string, unknown>)[d])
    if (!Number.isInteger(n) || n < 1 || n > MAX_TOPICS_PER_DOMAIN) {
      return { error: `topicCountByDomain.${d} must be an integer between 1 and ${MAX_TOPICS_PER_DOMAIN}` }
    }
    result[d] = n
  }
  return { topicCountByDomain: result }
}

// Same rules as the length ladder always had: non-empty, positive integers,
// no duplicates, sorted ascending before saving.
export function validateLengthLadder(values: unknown): { lengthLadder: number[] } | { error: string } {
  if (!Array.isArray(values) || values.length === 0) {
    return { error: 'The length ladder must be a non-empty array of word counts.' }
  }
  const numbers: number[] = []
  for (const v of values) {
    const n = Number(v)
    if (!Number.isInteger(n) || n <= 0) {
      return { error: `Every length must be a positive integer — got ${JSON.stringify(v)}.` }
    }
    numbers.push(n)
  }
  if (new Set(numbers).size !== numbers.length) {
    return { error: 'The length ladder contains duplicate values.' }
  }
  return { lengthLadder: [...numbers].sort((a, b) => a - b) }
}

export function validateIntensities(values: unknown): { intensities: number[] } | { error: string } {
  if (!Array.isArray(values) || values.length === 0) {
    return { error: 'intensities must be a non-empty array.' }
  }
  const numbers: number[] = []
  for (const v of values) {
    const n = Number(v)
    if (!Number.isInteger(n) || n < 1 || n > 10) {
      return { error: `Every intensity must be an integer between 1 and 10 — got ${JSON.stringify(v)}.` }
    }
    numbers.push(n)
  }
  if (new Set(numbers).size !== numbers.length) {
    return { error: 'intensities contains duplicate values.' }
  }
  return { intensities: [...numbers].sort((a, b) => a - b) }
}

export async function getCorpusProject(firestore: Firestore, id: string): Promise<CorpusProject | null> {
  const doc = await firestore.collection(COLLECTION).doc(id).get()
  return doc.exists ? (doc.data() as CorpusProject) : null
}

export async function listCorpusProjects(firestore: Firestore): Promise<CorpusProject[]> {
  const snap = await firestore.collection(COLLECTION).get()
  return snap.docs
    .map(d => d.data() as CorpusProject)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export interface CreateCorpusProjectParams {
  name: string
  benchmarkVersion?: string
  corpusVersion?: string
}

// Starts in 'draft' with every domain pre-selected (this admin tool has no
// concept of a domain outside the fixed 6-domain taxonomy) and no
// topicCountByDomain/lengthLadder yet — those are set via updateProjectDraft
// as the admin works through configuration, entirely independent of every
// other project.
export async function createCorpusProject(firestore: Firestore, params: CreateCorpusProjectParams): Promise<CorpusProject> {
  const nameError = validateProjectName(params.name)
  if (nameError) throw new Error(nameError)

  const now = new Date().toISOString()
  const ref = firestore.collection(COLLECTION).doc()
  const project: CorpusProject = {
    id: ref.id,
    name: params.name.trim(),
    benchmarkVersion: params.benchmarkVersion?.trim() || DEFAULT_BENCHMARK_VERSION,
    corpusVersion: params.corpusVersion?.trim() || DEFAULT_CORPUS_VERSION,
    domains: [...DOMAINS],
    topicCountByDomain: {},
    lengthLadder: [],
    intensities: [...DEFAULT_INTENSITIES],
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    frozenAt: null,
  }
  await ref.set(project)
  return project
}

export type ProjectDraftPatch = Partial<
  Pick<CorpusProject, 'name' | 'benchmarkVersion' | 'corpusVersion' | 'domains' | 'topicCountByDomain' | 'lengthLadder' | 'intensities'>
>

// Every configuration field is only editable while still 'draft' — once a
// blueprint is locked, changing domains/counts/ladder would leave existing
// topics and sources referencing slots or lengths the new configuration
// might not even include.
export async function updateProjectDraft(firestore: Firestore, id: string, patch: ProjectDraftPatch): Promise<CorpusProject> {
  const existing = await getCorpusProject(firestore, id)
  if (!existing) throw new Error('Corpus project not found.')
  if (existing.status !== 'draft') {
    throw new Error(`Cannot edit configuration once a project is ${existing.status} — this must stay in 'draft'.`)
  }

  const next: CorpusProject = { ...existing }
  if (patch.name !== undefined) {
    const error = validateProjectName(patch.name)
    if (error) throw new Error(error)
    next.name = patch.name.trim()
  }
  if (patch.benchmarkVersion !== undefined) next.benchmarkVersion = patch.benchmarkVersion.trim() || existing.benchmarkVersion
  if (patch.corpusVersion !== undefined) next.corpusVersion = patch.corpusVersion.trim() || existing.corpusVersion
  if (patch.domains !== undefined) {
    const result = validateDomains(patch.domains)
    if ('error' in result) throw new Error(result.error)
    next.domains = result.domains
    // Drop counts for domains no longer selected, so a stale entry can't
    // silently survive a domain being removed and reappear if it's re-added.
    next.topicCountByDomain = Object.fromEntries(
      Object.entries(existing.topicCountByDomain).filter(([d]) => result.domains.includes(d as Domain)),
    )
  }
  if (patch.topicCountByDomain !== undefined) {
    const result = validateTopicCountByDomain(patch.topicCountByDomain, next.domains)
    if ('error' in result) throw new Error(result.error)
    next.topicCountByDomain = result.topicCountByDomain
  }
  if (patch.lengthLadder !== undefined) {
    const result = validateLengthLadder(patch.lengthLadder)
    if ('error' in result) throw new Error(result.error)
    next.lengthLadder = result.lengthLadder
  }
  if (patch.intensities !== undefined) {
    const result = validateIntensities(patch.intensities)
    if ('error' in result) throw new Error(result.error)
    next.intensities = result.intensities
  }
  next.updatedAt = new Date().toISOString()

  await firestore.collection(COLLECTION).doc(id).set(next)
  return next
}

// Locks the whole project's blueprint at once — every selected domain must
// already have exactly its configured topicCountByDomain[domain] topics
// generated (generateOutline/expandOutline), so there is no partially-drawn
// roster hiding behind a lock. After this, corpus source generation is
// allowed; configuration and the topic roster itself are both immutable.
export async function lockBlueprint(firestore: Firestore, id: string): Promise<CorpusProject> {
  const project = await getCorpusProject(firestore, id)
  if (!project) throw new Error('Corpus project not found.')
  if (project.status !== 'draft') throw new Error(`Cannot lock — project is already ${project.status}.`)
  if (project.domains.length === 0) throw new Error('Select at least one domain before locking.')
  if (project.lengthLadder.length === 0) throw new Error('Configure a length ladder before locking.')

  for (const d of project.domains) {
    const target = project.topicCountByDomain[d]
    if (!target) throw new Error(`Set a topic count for ${d} before locking.`)
    const existing = await listTopics(firestore, id, d)
    if (existing.length !== target) {
      throw new Error(`${d} has ${existing.length} of ${target} topics generated — finish the blueprint before locking.`)
    }
  }

  const updated: CorpusProject = { ...project, status: 'blueprint_locked', updatedAt: new Date().toISOString() }
  await firestore.collection(COLLECTION).doc(id).set(updated)
  return updated
}

// Called by corpus.ts's generateSource the first time a source is
// successfully generated for a project — records that source generation is
// actually underway without requiring a separate admin button click. A
// no-op once already past 'blueprint_locked'.
export async function markGeneratingIfNeeded(firestore: Firestore, id: string): Promise<void> {
  const project = await getCorpusProject(firestore, id)
  if (project?.status === 'blueprint_locked') {
    await firestore.collection(COLLECTION).doc(id).update({ status: 'generating', updatedAt: new Date().toISOString() })
  }
}

// A project-level milestone marker (distinct from an individual
// CorpusSource's own 'frozen' status) — requires explicit confirmation per
// §23, the same as freezing any individual source.
export async function freezeCorpusProject(firestore: Firestore, id: string): Promise<CorpusProject> {
  const project = await getCorpusProject(firestore, id)
  if (!project) throw new Error('Corpus project not found.')
  if (project.status !== 'blueprint_locked' && project.status !== 'generating') {
    throw new Error(`Cannot freeze a project that is ${project.status} — lock the blueprint and generate sources first.`)
  }
  const frozenAt = new Date().toISOString()
  const updated: CorpusProject = { ...project, status: 'frozen', frozenAt, updatedAt: frozenAt }
  await firestore.collection(COLLECTION).doc(id).set(updated)
  return updated
}

export async function archiveCorpusProject(firestore: Firestore, id: string): Promise<CorpusProject> {
  const project = await getCorpusProject(firestore, id)
  if (!project) throw new Error('Corpus project not found.')
  const updated: CorpusProject = { ...project, status: 'archived', updatedAt: new Date().toISOString() }
  await firestore.collection(COLLECTION).doc(id).set(updated)
  return updated
}

// Copies configuration and the generated topic blueprint into a brand-new
// project — never the generated corpus sources, detector results, or
// Humanite outputs, which is exactly what makes this useful for trying a
// different layout without rebuilding everything by hand. The new project
// starts back at 'draft' even if the source was locked/generating/frozen,
// since its own blueprint (freshly copied) hasn't been locked yet under its
// own id.
export async function duplicateCorpusProject(firestore: Firestore, id: string, newName: string): Promise<CorpusProject> {
  const source = await getCorpusProject(firestore, id)
  if (!source) throw new Error('Corpus project not found.')
  const nameError = validateProjectName(newName)
  if (nameError) throw new Error(nameError)

  const now = new Date().toISOString()
  const ref = firestore.collection(COLLECTION).doc()
  const copy: CorpusProject = {
    id: ref.id,
    name: newName.trim(),
    benchmarkVersion: source.benchmarkVersion,
    corpusVersion: source.corpusVersion,
    domains: [...source.domains],
    topicCountByDomain: { ...source.topicCountByDomain },
    lengthLadder: [...source.lengthLadder],
    intensities: [...source.intensities],
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    frozenAt: null,
  }
  await ref.set(copy)

  const sourceTopics = await listTopics(firestore, id)
  await Promise.all(
    sourceTopics.map(t =>
      createTopic(firestore, {
        corpusProjectId: copy.id,
        domainId: t.domainId,
        topicNumber: t.topicNumber,
        title: t.title,
        description: t.description,
        intendedAudience: t.intendedAudience,
        writingType: t.writingType,
        coreConcepts: t.coreConcepts,
        generationPromptVersion: t.generationPromptVersion,
      }),
    ),
  )

  return copy
}

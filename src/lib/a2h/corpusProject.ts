import type { Firestore } from 'firebase-admin/firestore'
import { createHash } from 'crypto'
import { DOMAINS, type Domain } from '@/lib/style/types'
import {
  DEFAULT_CORPUS_VERSION, DEFAULT_BENCHMARK_VERSION, DEFAULT_LENGTH_LADDER, TOPICS_PER_DOMAIN,
  MAX_TOPICS_PER_DOMAIN, A2H_COLLECTIONS,
  type CorpusProject, type CorpusSource, type CorpusManifest,
} from './types'
import { listTopics, createTopic } from './topics'

const COLLECTION = A2H_COLLECTIONS.projects

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

export function validateTopicCountDefault(value: unknown): { topicCountDefault: number } | { error: string } {
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1 || n > MAX_TOPICS_PER_DOMAIN) {
    return { error: `topicCountDefault must be an integer between 1 and ${MAX_TOPICS_PER_DOMAIN}` }
  }
  return { topicCountDefault: n }
}

// Overrides are optional per domain (that's the point — only the domains an
// admin explicitly deviates from the shared default need an entry here), so
// unlike the old topicCountByDomain this never requires covering every
// selected domain. Keys outside the current domain selection are rejected
// rather than silently accepted, since the UI only ever offers an override
// control for a domain that's actually selected.
export function validateTopicCountOverrides(
  value: unknown,
  domains: Domain[],
): { topicCountOverrides: Partial<Record<Domain, number>> } | { error: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { error: 'topicCountOverrides must be an object.' }
  }
  const result: Partial<Record<Domain, number>> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!domains.includes(key as Domain)) {
      return { error: `topicCountOverrides.${key} is not a selected domain for this project.` }
    }
    const n = Number(raw)
    if (!Number.isInteger(n) || n < 1 || n > MAX_TOPICS_PER_DOMAIN) {
      return { error: `topicCountOverrides.${key} must be an integer between 1 and ${MAX_TOPICS_PER_DOMAIN}` }
    }
    result[key as Domain] = n
  }
  return { topicCountOverrides: result }
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

// The single source of truth for a domain's effective topic count — an
// explicit override always wins, otherwise the project-wide default
// applies. topicCountByDomain is just this function applied to every
// selected domain, recomputed and persisted on every draft edit so it can
// never drift out of sync with topicCountDefault/topicCountOverrides.
export function resolveTopicCountByDomain(
  domains: Domain[],
  topicCountDefault: number,
  topicCountOverrides: Partial<Record<Domain, number>>,
): Partial<Record<Domain, number>> {
  const result: Partial<Record<Domain, number>> = {}
  for (const d of domains) {
    result[d] = topicCountOverrides[d] ?? topicCountDefault
  }
  return result
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

// Starts in 'draft' but already fully configured to the standard A2H
// Version 1 shape (6 domains, 20 topic families/domain, the standard
// 10-point length ladder = 1,200 expected sources) — the common case needs
// no configuration at all, only a name. An admin who wants something else
// edits from here; nothing below forces a blank slate.
export async function createCorpusProject(firestore: Firestore, params: CreateCorpusProjectParams): Promise<CorpusProject> {
  const nameError = validateProjectName(params.name)
  if (nameError) throw new Error(nameError)

  const now = new Date().toISOString()
  const ref = firestore.collection(COLLECTION).doc()
  const domains = [...DOMAINS]
  const topicCountDefault = TOPICS_PER_DOMAIN
  const topicCountOverrides: Partial<Record<Domain, number>> = {}
  const project: CorpusProject = {
    id: ref.id,
    name: params.name.trim(),
    benchmarkVersion: params.benchmarkVersion?.trim() || DEFAULT_BENCHMARK_VERSION,
    corpusVersion: params.corpusVersion?.trim() || DEFAULT_CORPUS_VERSION,
    domains,
    topicCountDefault,
    topicCountOverrides,
    topicCountByDomain: resolveTopicCountByDomain(domains, topicCountDefault, topicCountOverrides),
    lengthLadder: [...DEFAULT_LENGTH_LADDER],
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    frozenAt: null,
  }
  await ref.set(project)
  return project
}

export type ProjectDraftPatch = Partial<
  Pick<CorpusProject, 'name' | 'benchmarkVersion' | 'corpusVersion' | 'domains' | 'topicCountDefault' | 'topicCountOverrides' | 'lengthLadder'>
>

// Every configuration field is only editable while still 'draft' — once a
// blueprint is locked, changing domains/counts/ladder would leave existing
// topics and sources referencing slots or lengths the new configuration
// might not even include. topicCountByDomain is always recomputed at the
// end from (domains, topicCountDefault, topicCountOverrides) regardless of
// which of those three actually changed, so it can never be saved out of
// sync — e.g. raising the shared default immediately propagates to every
// domain that doesn't have its own override.
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
    // Drop overrides for domains no longer selected, so a stale entry can't
    // silently survive a domain being removed and reappear if it's re-added.
    next.topicCountOverrides = Object.fromEntries(
      Object.entries(next.topicCountOverrides).filter(([d]) => result.domains.includes(d as Domain)),
    )
  }
  if (patch.topicCountDefault !== undefined) {
    const result = validateTopicCountDefault(patch.topicCountDefault)
    if ('error' in result) throw new Error(result.error)
    next.topicCountDefault = result.topicCountDefault
  }
  if (patch.topicCountOverrides !== undefined) {
    const result = validateTopicCountOverrides(patch.topicCountOverrides, next.domains)
    if ('error' in result) throw new Error(result.error)
    next.topicCountOverrides = result.topicCountOverrides
  }
  if (patch.lengthLadder !== undefined) {
    const result = validateLengthLadder(patch.lengthLadder)
    if ('error' in result) throw new Error(result.error)
    next.lengthLadder = result.lengthLadder
  }
  next.topicCountByDomain = resolveTopicCountByDomain(next.domains, next.topicCountDefault, next.topicCountOverrides)
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

export interface FreezeValidationCell {
  domainId: Domain
  topicId: string
  topicTitle: string
  targetWords: number
}

// Everything a "Cannot freeze corpus" UI needs to explain exactly what's
// incomplete, per cell — never just a pass/fail boolean.
export interface FreezeValidationResult {
  ok: boolean
  expectedSourceCount: number
  actualSourceCount: number
  frozenCount: number
  validatedNotFrozenCount: number
  validationFailedCount: number
  missingCells: FreezeValidationCell[]
  problems: string[]
}

// Computes whether a project's entire topic x length matrix is complete and
// frozen — the check freezeCorpusProject enforces before it will allow a
// whole-corpus freeze. Queries a2hCorpusSources directly (rather than
// importing corpus.ts's listSources) to avoid a circular module dependency,
// since corpus.ts already imports getCorpusProject/markGeneratingIfNeeded
// from this file.
export async function validateCorpusForFreeze(firestore: Firestore, project: CorpusProject): Promise<FreezeValidationResult> {
  const allTopics = await listTopics(firestore, project.id)
  const relevantTopics = allTopics.filter(t => project.domains.includes(t.domainId))

  const sourcesSnap = await firestore.collection(A2H_COLLECTIONS.sources).where('corpusProjectId', '==', project.id).get()
  const sources = sourcesSnap.docs.map(d => d.data() as CorpusSource)

  const byCell = new Map<string, CorpusSource[]>()
  const problems: string[] = []
  for (const s of sources) {
    // Defensive — the query above already scopes by corpusProjectId, but a
    // stored record claiming a different project would mean opaque ids were
    // trusted as proof of ownership, exactly what this check exists to rule
    // out.
    if (s.corpusProjectId !== project.id) {
      problems.push(`Source ${s.id} is stored under this project's query but claims corpusProjectId ${s.corpusProjectId}.`)
      continue
    }
    const key = `${s.topicId}__${s.targetWords}`
    const list = byCell.get(key) ?? []
    list.push(s)
    byCell.set(key, list)
  }

  let frozenCount = 0
  let validatedNotFrozenCount = 0
  let validationFailedCount = 0
  const missingCells: FreezeValidationCell[] = []

  for (const topic of relevantTopics) {
    for (const targetWords of project.lengthLadder) {
      const key = `${topic.id}__${targetWords}`
      const cellSources = byCell.get(key) ?? []
      if (cellSources.length === 0) {
        missingCells.push({ domainId: topic.domainId, topicId: topic.id, topicTitle: topic.title, targetWords })
        continue
      }
      if (cellSources.length > 1) {
        problems.push(`Duplicate source records exist for "${topic.title}" at ${targetWords} words.`)
      }
      const source = cellSources[0]!
      if (source.status === 'frozen') frozenCount++
      else if (source.status === 'validated') validatedNotFrozenCount++
      else if (source.status === 'validation_failed') validationFailedCount++
    }
  }

  const expectedSourceCount = relevantTopics.length * project.lengthLadder.length
  const ok = problems.length === 0
    && missingCells.length === 0
    && validatedNotFrozenCount === 0
    && validationFailedCount === 0
    && frozenCount === expectedSourceCount

  return {
    ok,
    expectedSourceCount,
    actualSourceCount: sources.length,
    frozenCount,
    validatedNotFrozenCount,
    validationFailedCount,
    missingCells,
    problems,
  }
}

function stableHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

// A deterministic hash of the topic roster's content (not ids/timestamps),
// so two projects generated from an identical blueprint hash identically —
// useful for confirming a duplicated project's topics haven't drifted from
// its source.
function computeTopicBlueprintHash(topics: { domainId: Domain; topicNumber: number; title: string; description: string; intendedAudience: string; writingType: string; coreConcepts: string[] }[]): string {
  const sorted = [...topics]
    .sort((a, b) => a.domainId.localeCompare(b.domainId) || a.topicNumber - b.topicNumber)
    .map(t => ({
      domainId: t.domainId, topicNumber: t.topicNumber, title: t.title, description: t.description,
      intendedAudience: t.intendedAudience, writingType: t.writingType, coreConcepts: t.coreConcepts,
    }))
  return stableHash(sorted)
}

// A project-level milestone marker (distinct from an individual
// CorpusSource's own 'frozen' status) — requires explicit confirmation per
// §23, the same as freezing any individual source. Unlike the earlier
// version, this refuses to freeze an incomplete matrix: every expected
// topic/length cell must exist and be frozen, with nothing validated-only
// or validation_failed left behind. On success, writes an immutable
// CorpusManifest recording exactly what was frozen.
export async function freezeCorpusProject(firestore: Firestore, id: string): Promise<CorpusProject> {
  const project = await getCorpusProject(firestore, id)
  if (!project) throw new Error('Corpus project not found.')
  if (project.status !== 'blueprint_locked' && project.status !== 'generating') {
    throw new Error(`Cannot freeze a project that is ${project.status} — lock the blueprint and generate sources first.`)
  }

  const validation = await validateCorpusForFreeze(firestore, project)
  if (!validation.ok) {
    throw new Error(
      `Cannot freeze corpus — expected ${validation.expectedSourceCount} sources, ${validation.frozenCount} frozen, `
      + `${validation.missingCells.length} missing, ${validation.validatedNotFrozenCount} not frozen, `
      + `${validation.validationFailedCount} failed validation.`,
    )
  }

  const frozenAt = new Date().toISOString()
  const allTopics = await listTopics(firestore, id)
  const relevantTopics = allTopics.filter(t => project.domains.includes(t.domainId))
  const sourcesSnap = await firestore.collection(A2H_COLLECTIONS.sources).where('corpusProjectId', '==', id).get()
  const sources = sourcesSnap.docs.map(d => d.data() as CorpusSource)

  const sourceHashes: Record<string, string> = {}
  for (const s of sources) sourceHashes[`${s.topicId}__${s.targetWords}`] = s.sha256

  const topicBlueprintHash = computeTopicBlueprintHash(relevantTopics)
  const manifestWithoutHash: Omit<CorpusManifest, 'manifestHash'> = {
    corpusProjectId: id,
    name: project.name,
    benchmarkVersion: project.benchmarkVersion,
    corpusVersion: project.corpusVersion,
    domains: project.domains,
    topicCountByDomain: project.topicCountByDomain,
    lengthLadder: project.lengthLadder,
    expectedSourceCount: validation.expectedSourceCount,
    actualSourceCount: validation.actualSourceCount,
    topicBlueprintHash,
    sourceHashes,
    frozenAt,
  }
  const manifest: CorpusManifest = { ...manifestWithoutHash, manifestHash: stableHash(manifestWithoutHash) }
  await firestore.collection(A2H_COLLECTIONS.manifests).doc(id).set(manifest)

  const updated: CorpusProject = { ...project, status: 'frozen', frozenAt, updatedAt: frozenAt }
  await firestore.collection(COLLECTION).doc(id).set(updated)
  return updated
}

export async function getCorpusManifest(firestore: Firestore, corpusProjectId: string): Promise<CorpusManifest | null> {
  const doc = await firestore.collection(A2H_COLLECTIONS.manifests).doc(corpusProjectId).get()
  return doc.exists ? (doc.data() as CorpusManifest) : null
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
    topicCountDefault: source.topicCountDefault,
    topicCountOverrides: { ...source.topicCountOverrides },
    topicCountByDomain: resolveTopicCountByDomain(source.domains, source.topicCountDefault, source.topicCountOverrides),
    lengthLadder: [...source.lengthLadder],
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

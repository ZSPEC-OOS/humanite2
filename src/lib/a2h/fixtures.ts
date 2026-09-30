import type { Firestore } from 'firebase-admin/firestore'
import {
  A2H_COLLECTIONS, DEFAULT_FIXTURE_VERSION,
  type A2HFixtureType, type BenchmarkFixture, type FixtureSet, type FixtureSetStatus,
} from './types'
import { getCorpusProject } from './corpusProject'
import { getSourceById, listSources } from './corpus'
import { validateCitationFixtureExpected, extractCitationCandidates } from './a2h04'
import { validateNumericUnitFixtureExpected, extractNumericUnitCandidates } from './a2h05'
import { validateModalityFixtureExpected, extractModalityCandidates } from './a2h09'
import { validateProtectedTermFixtureExpected, extractProtectedTermCandidates } from './a2h10'
import { validateTerminologyFixtureExpected } from './a2h13'

const SETS = A2H_COLLECTIONS.fixtureSets
const FIXTURES = A2H_COLLECTIONS.fixtures

const VALID_TYPES: A2HFixtureType[] = ['citation', 'numeric_unit', 'modality', 'protected_term', 'terminology']

function validateExpectedShape(type: A2HFixtureType, expected: Record<string, unknown>): string[] {
  switch (type) {
    case 'citation': return validateCitationFixtureExpected(expected)
    case 'numeric_unit': return validateNumericUnitFixtureExpected(expected)
    case 'modality': return validateModalityFixtureExpected(expected)
    case 'protected_term': return validateProtectedTermFixtureExpected(expected)
    case 'terminology': return validateTerminologyFixtureExpected(expected)
  }
}

// ── Fixture Sets ──────────────────────────────────────────────────────────

function versionNumberOf(fixtureVersion: string): number {
  const m = /^FIXTURE-V(\d+)$/.exec(fixtureVersion)
  return m ? Number(m[1]) : 0
}

function formatVersion(n: number): string {
  return n === 1 ? DEFAULT_FIXTURE_VERSION : `FIXTURE-V${String(n).padStart(3, '0')}`
}

export interface CreateFixtureSetParams {
  corpusProjectId: string
  name: string
}

// A corrected fixture set is always a NEW version (§2/§26) — this never
// reuses or reopens a prior version's id, even for the same corpus project;
// the version number is simply one past the highest FIXTURE-V### this
// project already has.
export async function createFixtureSet(firestore: Firestore, params: CreateFixtureSetParams): Promise<FixtureSet> {
  if (!params.name?.trim()) throw new Error('name is required')
  const project = await getCorpusProject(firestore, params.corpusProjectId)
  if (!project) throw new Error('Corpus project not found.')

  const existing = await listFixtureSetsForProject(firestore, params.corpusProjectId)
  const nextVersion = Math.max(0, ...existing.map(s => versionNumberOf(s.fixtureVersion))) + 1

  const now = new Date().toISOString()
  const ref = firestore.collection(SETS).doc()
  const set: FixtureSet = {
    id: ref.id,
    corpusProjectId: params.corpusProjectId,
    name: params.name.trim(),
    fixtureVersion: formatVersion(nextVersion),
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    lockedAt: null,
  }
  await ref.set(set)
  return set
}

export async function getFixtureSet(firestore: Firestore, id: string): Promise<FixtureSet | null> {
  const doc = await firestore.collection(SETS).doc(id).get()
  return doc.exists ? (doc.data() as FixtureSet) : null
}

export async function listFixtureSetsForProject(firestore: Firestore, corpusProjectId: string): Promise<FixtureSet[]> {
  const snap = await firestore.collection(SETS).where('corpusProjectId', '==', corpusProjectId).get()
  return snap.docs.map(d => d.data() as FixtureSet).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

// ── Fixtures ──────────────────────────────────────────────────────────────

export interface CreateFixtureInput {
  fixtureSetId: string
  sourceId: string
  type: A2HFixtureType
  expected: Record<string, unknown>
  ordinal?: number
  sourceStart?: number | null
  sourceEnd?: number | null
  sourceText?: string | null
  notes?: string | null
}

function assertMutable(set: FixtureSet | null): asserts set is FixtureSet {
  if (!set) throw new Error('Fixture set not found.')
  if (set.status === 'locked' || set.status === 'archived') {
    throw new Error(`Cannot modify fixtures — fixture set is ${set.status}.`)
  }
}

// Every fixture must reference a real FROZEN source belonging to the
// fixture set's own corpus project (§3/§45) — enforced here, server-side,
// independent of anything the UI happens to disable.
export async function createFixture(firestore: Firestore, input: CreateFixtureInput): Promise<BenchmarkFixture> {
  if (!VALID_TYPES.includes(input.type)) throw new Error(`type must be one of ${VALID_TYPES.join(', ')}.`)
  const set = await getFixtureSet(firestore, input.fixtureSetId)
  assertMutable(set)

  const source = await getSourceById(firestore, input.sourceId)
  if (!source) throw new Error('Source not found.')
  if (source.corpusProjectId !== set.corpusProjectId) throw new Error("Source does not belong to this fixture set's corpus project.")
  if (source.status !== 'frozen') throw new Error('Fixtures can only be attached to a frozen source.')

  const shapeErrors = validateExpectedShape(input.type, input.expected)
  if (shapeErrors.length > 0) throw new Error(`Invalid fixture: ${shapeErrors.join(' ')}`)

  const siblings = (await listFixturesForSource(firestore, input.fixtureSetId, input.sourceId)).filter(f => f.type === input.type)
  let ordinal = input.ordinal
  if (ordinal == null) {
    ordinal = siblings.length === 0 ? 0 : Math.max(...siblings.map(f => f.ordinal)) + 1
  } else if (siblings.some(f => f.ordinal === ordinal)) {
    throw new Error(`Ordinal ${ordinal} is already used for this source/type.`)
  }

  const now = new Date().toISOString()
  const ref = firestore.collection(FIXTURES).doc()
  const fixture: BenchmarkFixture = {
    id: ref.id,
    fixtureSetId: input.fixtureSetId,
    corpusProjectId: set.corpusProjectId,
    sourceId: input.sourceId,
    type: input.type,
    ordinal,
    expected: input.expected,
    sourceStart: input.sourceStart ?? null,
    sourceEnd: input.sourceEnd ?? null,
    sourceText: input.sourceText ?? null,
    notes: input.notes ?? null,
    createdAt: now,
    updatedAt: now,
  }
  await ref.set(fixture)
  return fixture
}

export type FixtureUpdatePatch = Partial<Pick<BenchmarkFixture, 'expected' | 'sourceStart' | 'sourceEnd' | 'sourceText' | 'notes'>>

export async function updateFixture(firestore: Firestore, fixtureId: string, patch: FixtureUpdatePatch): Promise<BenchmarkFixture> {
  const doc = await firestore.collection(FIXTURES).doc(fixtureId).get()
  if (!doc.exists) throw new Error('Fixture not found.')
  const fixture = doc.data() as BenchmarkFixture
  const set = await getFixtureSet(firestore, fixture.fixtureSetId)
  assertMutable(set)

  if (patch.expected !== undefined) {
    const shapeErrors = validateExpectedShape(fixture.type, patch.expected)
    if (shapeErrors.length > 0) throw new Error(`Invalid fixture: ${shapeErrors.join(' ')}`)
  }

  const next: BenchmarkFixture = { ...fixture, ...patch, updatedAt: new Date().toISOString() }
  await firestore.collection(FIXTURES).doc(fixtureId).set(next)
  return next
}

export async function deleteFixture(firestore: Firestore, fixtureId: string): Promise<void> {
  const doc = await firestore.collection(FIXTURES).doc(fixtureId).get()
  if (!doc.exists) return
  const fixture = doc.data() as BenchmarkFixture
  const set = await getFixtureSet(firestore, fixture.fixtureSetId)
  assertMutable(set)
  await firestore.collection(FIXTURES).doc(fixtureId).delete()
}

// One query per (fixtureSetId, sourceId) pair — the shared index every
// evaluator and the source-review UI reads through (§48/§49): a single
// call fetches every type of fixture a source has, instead of one query per
// fixture type. Requires a composite index on (fixtureSetId, sourceId); see
// firestore.indexes.json / the completion report.
export async function listFixturesForSource(firestore: Firestore, fixtureSetId: string, sourceId: string): Promise<BenchmarkFixture[]> {
  const snap = await firestore.collection(FIXTURES)
    .where('fixtureSetId', '==', fixtureSetId)
    .where('sourceId', '==', sourceId)
    .get()
  return snap.docs.map(d => d.data() as BenchmarkFixture).sort((a, b) => a.ordinal - b.ordinal)
}

export async function listFixturesForSet(firestore: Firestore, fixtureSetId: string): Promise<BenchmarkFixture[]> {
  const snap = await firestore.collection(FIXTURES).where('fixtureSetId', '==', fixtureSetId).get()
  return snap.docs.map(d => d.data() as BenchmarkFixture)
}

// ── Validation / lock (§25-26) ──────────────────────────────────────────

export interface FixtureCoverage {
  totalFixtures: number
  byType: Record<A2HFixtureType, number>
  sourcesWithAnyFixture: number
  totalFrozenSources: number
}

export interface FixtureSetValidationResult {
  ok: boolean
  errors: string[]
  coverage: FixtureCoverage
}

// The full §25 checklist. Does NOT require every source to have every
// fixture type (§25: "do not require every source to have every fixture
// type") — coverage is reported, never enforced as complete.
export async function validateFixtureSet(firestore: Firestore, fixtureSetId: string): Promise<FixtureSetValidationResult> {
  const set = await getFixtureSet(firestore, fixtureSetId)
  if (!set) throw new Error('Fixture set not found.')

  const errors: string[] = []
  const project = await getCorpusProject(firestore, set.corpusProjectId)
  if (!project) {
    errors.push('Corpus project not found.')
  } else if (project.status !== 'frozen') {
    errors.push(`Corpus project must be frozen to lock a fixture set — currently ${project.status}.`)
  }

  const allFixtures = await listFixturesForSet(firestore, fixtureSetId)
  const sourceIds = [...new Set(allFixtures.map(f => f.sourceId))]
  const sourcesById = new Map(
    (await Promise.all(sourceIds.map(id => getSourceById(firestore, id)))).filter((s): s is NonNullable<typeof s> => s != null).map(s => [s.id, s]),
  )

  const seenId = new Set<string>()
  const seenOrdinal = new Set<string>()
  const byType: Record<A2HFixtureType, number> = { citation: 0, numeric_unit: 0, modality: 0, protected_term: 0, terminology: 0 }

  for (const fixture of allFixtures) {
    if (seenId.has(fixture.id)) errors.push(`Duplicate fixture id ${fixture.id}.`)
    seenId.add(fixture.id)

    if (fixture.corpusProjectId !== set.corpusProjectId) {
      errors.push(`Fixture ${fixture.id} does not belong to this fixture set's corpus project.`)
    }

    const source = sourcesById.get(fixture.sourceId)
    if (!source) {
      errors.push(`Fixture ${fixture.id} references a missing source ${fixture.sourceId}.`)
    } else {
      if (source.corpusProjectId !== set.corpusProjectId) errors.push(`Fixture ${fixture.id}'s source does not belong to this fixture set's corpus project.`)
      if (source.status !== 'frozen') errors.push(`Fixture ${fixture.id}'s source ${fixture.sourceId} is not frozen.`)
    }

    const ordinalKey = `${fixture.sourceId}__${fixture.type}__${fixture.ordinal}`
    if (seenOrdinal.has(ordinalKey)) {
      errors.push(`Duplicate ordinal for source ${fixture.sourceId}, type ${fixture.type}, ordinal ${fixture.ordinal}.`)
    }
    seenOrdinal.add(ordinalKey)

    byType[fixture.type]++
    const fieldErrors = validateExpectedShape(fixture.type, fixture.expected)
    errors.push(...fieldErrors.map(e => `Fixture ${fixture.id}: ${e}`))
  }

  const frozenSources = project ? (await listSources(firestore, set.corpusProjectId)).filter(s => s.status === 'frozen') : []
  const coverage: FixtureCoverage = {
    totalFixtures: allFixtures.length,
    byType,
    sourcesWithAnyFixture: sourceIds.length,
    totalFrozenSources: frozenSources.length,
  }

  const ok = errors.length === 0
  if (ok && set.status === 'draft') {
    await firestore.collection(SETS).doc(fixtureSetId).update({ status: 'validated' satisfies FixtureSetStatus, updatedAt: new Date().toISOString() })
  }
  return { ok, errors, coverage }
}

export interface LockFixtureSetResult {
  set: FixtureSet
  result: FixtureSetValidationResult
}

// Locking makes a fixture set immutable (§26) — once locked, no fixture in
// it can ever be added, edited, or deleted again (assertMutable enforces
// this everywhere above); a correction requires a new fixture-set version.
export async function lockFixtureSet(firestore: Firestore, fixtureSetId: string): Promise<LockFixtureSetResult> {
  const existing = await getFixtureSet(firestore, fixtureSetId)
  if (!existing) throw new Error('Fixture set not found.')
  if (existing.status === 'locked') throw new Error('Fixture set is already locked.')
  if (existing.status === 'archived') throw new Error('Cannot lock an archived fixture set.')

  const result = await validateFixtureSet(firestore, fixtureSetId)
  if (!result.ok) return { set: existing, result }

  const now = new Date().toISOString()
  const locked: FixtureSet = { ...existing, status: 'locked', lockedAt: now, updatedAt: now }
  await firestore.collection(SETS).doc(fixtureSetId).set(locked)
  return { set: locked, result }
}

// ── Candidate extraction (§22) ────────────────────────────────────────────

export interface FixtureCandidates {
  citation: ReturnType<typeof extractCitationCandidates>
  numeric_unit: ReturnType<typeof extractNumericUnitCandidates>
  modality: ReturnType<typeof extractModalityCandidates>
  protected_term: ReturnType<typeof extractProtectedTermCandidates>
}

// Deterministic-extraction-assisted fixture creation (§22): proposes
// candidates from the frozen source's own text for the admin to review and
// approve, never persisted or treated as authoritative automatically.
// Terminology has no extractor — the spec explicitly expects that class to
// need curation, since "preferred term" is a judgment call this module has
// no basis for guessing.
export function scanSourceForCandidates(sourceText: string): FixtureCandidates {
  return {
    citation: extractCitationCandidates(sourceText),
    numeric_unit: extractNumericUnitCandidates(sourceText),
    modality: extractModalityCandidates(sourceText),
    protected_term: extractProtectedTermCandidates(sourceText),
  }
}

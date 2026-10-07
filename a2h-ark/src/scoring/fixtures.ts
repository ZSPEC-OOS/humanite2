// PORTED from humanite2 src/lib/a2h/fixtures.ts @ 141e366: the pure parts only. Firestore reads and
// writes (createFixtureSet/createFixture/updateFixture/deleteFixture/list*/lock persistence) are removed;
// their decision logic is kept as pure functions that take the already-loaded records, an id and a
// timestamp (the ark has no clock and no id source of its own).
import {
  DEFAULT_FIXTURE_VERSION, FIXTURE_TYPE_FOR_TEST,
  type A2HFixtureType, type A2HTestCode, type BenchmarkFixture, type CorpusProject, type CorpusSource,
  type FixtureSet, type FixtureSetStatus,
} from '../shared/types'
import { validateCitationFixtureExpected, extractCitationCandidates } from './a2h04'
import { validateNumericUnitFixtureExpected, extractNumericUnitCandidates } from './a2h05'
import { validateModalityFixtureExpected, extractModalityCandidates } from './a2h09'
import { validateProtectedTermFixtureExpected, extractProtectedTermCandidates } from './a2h10'
import { validateTerminologyFixtureExpected } from './a2h13'
import { validateGrammarRepairFixtureExpected } from './a2h06'
import { validateFactualRepairFixtureExpected } from './a2h12'
import { validateClaimRelationshipFixtureExpected } from './a2h16'

// The fixture type each test scores (re-exported from the shared types).
export { FIXTURE_TYPE_FOR_TEST }

export const VALID_TYPES: A2HFixtureType[] = ['citation', 'numeric_unit', 'modality', 'protected_term', 'terminology', 'grammar_repair', 'factual_repair', 'claim_relationship']

export function fixtureTypeForTest(code: A2HTestCode): A2HFixtureType | null {
  return FIXTURE_TYPE_FOR_TEST[code] ?? null
}

export function validateExpectedShape(type: A2HFixtureType, expected: Record<string, unknown>): string[] {
  switch (type) {
    case 'citation': return validateCitationFixtureExpected(expected)
    case 'numeric_unit': return validateNumericUnitFixtureExpected(expected)
    case 'modality': return validateModalityFixtureExpected(expected)
    case 'protected_term': return validateProtectedTermFixtureExpected(expected)
    case 'terminology': return validateTerminologyFixtureExpected(expected)
    case 'grammar_repair': return validateGrammarRepairFixtureExpected(expected)
    case 'factual_repair': return validateFactualRepairFixtureExpected(expected)
    case 'claim_relationship': return validateClaimRelationshipFixtureExpected(expected)
  }
}

// ── Fixture Sets ──────────────────────────────────────────────────────────

export function versionNumberOf(fixtureVersion: string): number {
  const m = /^FIXTURE-V(\d+)$/.exec(fixtureVersion)
  return m ? Number(m[1]) : 0
}

export function formatVersion(n: number): string {
  return n === 1 ? DEFAULT_FIXTURE_VERSION : `FIXTURE-V${String(n).padStart(3, '0')}`
}

export interface CreateFixtureSetParams {
  corpusProjectId: string
  name: string
}

// A corrected fixture set is always a NEW version (§2/§26): the version number is one past the
// highest FIXTURE-V### this project already has. `project` null means "not found".
export function buildFixtureSet(
  params: CreateFixtureSetParams,
  project: Pick<CorpusProject, 'id'> | null,
  existingSetsForProject: FixtureSet[],
  id: string,
  now: string,
): FixtureSet {
  if (!params.name?.trim()) throw new Error('name is required')
  if (!project) throw new Error('Corpus project not found.')
  const nextVersion = Math.max(0, ...existingSetsForProject.map(s => versionNumberOf(s.fixtureVersion))) + 1
  return {
    id,
    corpusProjectId: params.corpusProjectId,
    name: params.name.trim(),
    fixtureVersion: formatVersion(nextVersion),
    status: 'draft',
    createdAt: now,
    updatedAt: now,
    lockedAt: null,
  }
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
  corruptionGeneratorVersion?: string | null
}

export function assertMutable(set: FixtureSet | null): asserts set is FixtureSet {
  if (!set) throw new Error('Fixture set not found.')
  if (set.status === 'locked' || set.status === 'archived') {
    throw new Error(`Cannot modify fixtures — fixture set is ${set.status}.`)
  }
}

// Every fixture must reference a real FROZEN source belonging to the fixture set's own corpus
// project (§3/§45). `siblingsOfSource` is every fixture the set already has for this source (any type).
export function buildFixture(
  input: CreateFixtureInput,
  set: FixtureSet | null,
  source: Pick<CorpusSource, 'corpusProjectId' | 'status'> | null,
  siblingsOfSource: BenchmarkFixture[],
  id: string,
  now: string,
): BenchmarkFixture {
  if (!VALID_TYPES.includes(input.type)) throw new Error(`type must be one of ${VALID_TYPES.join(', ')}.`)
  assertMutable(set)

  if (!source) throw new Error('Source not found.')
  if (source.corpusProjectId !== set.corpusProjectId) throw new Error("Source does not belong to this fixture set's corpus project.")
  if (source.status !== 'frozen') throw new Error('Fixtures can only be attached to a frozen source.')

  const shapeErrors = validateExpectedShape(input.type, input.expected)
  if (shapeErrors.length > 0) throw new Error(`Invalid fixture: ${shapeErrors.join(' ')}`)

  const siblings = siblingsOfSource.filter(f => f.type === input.type)
  let ordinal = input.ordinal
  if (ordinal == null) {
    ordinal = siblings.length === 0 ? 0 : Math.max(...siblings.map(f => f.ordinal)) + 1
  } else if (siblings.some(f => f.ordinal === ordinal)) {
    throw new Error(`Ordinal ${ordinal} is already used for this source/type.`)
  }

  return {
    id,
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
    corruptionGeneratorVersion: input.corruptionGeneratorVersion ?? null,
    createdAt: now,
    updatedAt: now,
  }
}

export type FixtureUpdatePatch = Partial<Pick<BenchmarkFixture, 'expected' | 'sourceStart' | 'sourceEnd' | 'sourceText' | 'notes'>>

export function applyFixtureUpdate(fixture: BenchmarkFixture | null, set: FixtureSet | null, patch: FixtureUpdatePatch, now: string): BenchmarkFixture {
  if (!fixture) throw new Error('Fixture not found.')
  assertMutable(set)
  if (patch.expected !== undefined) {
    const shapeErrors = validateExpectedShape(fixture.type, patch.expected)
    if (shapeErrors.length > 0) throw new Error(`Invalid fixture: ${shapeErrors.join(' ')}`)
  }
  return { ...fixture, ...patch, updatedAt: now }
}

// ── Matching fixtures to sources ─────────────────────────────────────────

// What the shared index returns for one (fixtureSetId, sourceId): every fixture of that source,
// ordered by ordinal (as listFixturesForSource sorted them).
export function fixturesForSource(fixtures: BenchmarkFixture[], fixtureSetId: string, sourceId: string): BenchmarkFixture[] {
  return fixtures.filter(f => f.fixtureSetId === fixtureSetId && f.sourceId === sourceId).sort((a, b) => a.ordinal - b.ordinal)
}

export function fixturesBySource(fixtures: BenchmarkFixture[], fixtureSetId: string): Map<string, BenchmarkFixture[]> {
  const bySource = new Map<string, BenchmarkFixture[]>()
  for (const f of fixtures) {
    if (f.fixtureSetId !== fixtureSetId) continue
    const list = bySource.get(f.sourceId)
    if (list) list.push(f)
    else bySource.set(f.sourceId, [f])
  }
  for (const list of bySource.values()) list.sort((a, b) => a.ordinal - b.ordinal)
  return bySource
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

export interface FixtureSetValidationInput {
  set: FixtureSet
  /** null when the corpus project is missing. */
  project: Pick<CorpusProject, 'status'> | null
  /** Every fixture of the set. */
  fixtures: BenchmarkFixture[]
  /** The sources the fixtures reference (a missing one is simply absent). */
  sourcesById: Map<string, Pick<CorpusSource, 'corpusProjectId' | 'status'>>
  /** Every source of the project (only frozen ones count toward coverage); empty when the project is missing. */
  projectSources: Array<Pick<CorpusSource, 'status'>>
}

// The full §25 checklist. Does NOT require every source to have every fixture type — coverage is
// reported, never enforced as complete. `nextStatus` is what the set's status becomes ('validated' when
// ok and still a draft); persisting it is the caller's job.
export function validateFixtureSet(input: FixtureSetValidationInput): FixtureSetValidationResult & { nextStatus: FixtureSetStatus } {
  const { set, project, fixtures: allFixtures, sourcesById, projectSources } = input
  const errors: string[] = []
  if (!project) {
    errors.push('Corpus project not found.')
  } else if (project.status !== 'frozen') {
    errors.push(`Corpus project must be frozen to lock a fixture set — currently ${project.status}.`)
  }

  const sourceIds = [...new Set(allFixtures.map(f => f.sourceId))]
  const seenId = new Set<string>()
  const seenOrdinal = new Set<string>()
  const byType: Record<A2HFixtureType, number> = { citation: 0, numeric_unit: 0, modality: 0, protected_term: 0, terminology: 0, grammar_repair: 0, factual_repair: 0, claim_relationship: 0 }

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

  const frozenSources = project ? projectSources.filter(s => s.status === 'frozen') : []
  const coverage: FixtureCoverage = {
    totalFixtures: allFixtures.length,
    byType,
    sourcesWithAnyFixture: sourceIds.length,
    totalFrozenSources: frozenSources.length,
  }

  const ok = errors.length === 0
  const nextStatus: FixtureSetStatus = ok && set.status === 'draft' ? 'validated' : set.status
  return { ok, errors, coverage, nextStatus }
}

export interface LockFixtureSetResult {
  set: FixtureSet
  result: FixtureSetValidationResult
}

// Locking makes a fixture set immutable (§26). When validation fails the set is returned unchanged.
export function lockFixtureSet(input: FixtureSetValidationInput, now: string): LockFixtureSetResult {
  const existing = input.set
  if (existing.status === 'locked') throw new Error('Fixture set is already locked.')
  if (existing.status === 'archived') throw new Error('Cannot lock an archived fixture set.')

  const { nextStatus: _nextStatus, ...result } = validateFixtureSet(input)
  if (!result.ok) return { set: existing, result }

  const locked: FixtureSet = { ...existing, status: 'locked', lockedAt: now, updatedAt: now }
  return { set: locked, result }
}

// ── Candidate extraction (§22) ────────────────────────────────────────────

export interface FixtureCandidates {
  citation: ReturnType<typeof extractCitationCandidates>
  numeric_unit: ReturnType<typeof extractNumericUnitCandidates>
  modality: ReturnType<typeof extractModalityCandidates>
  protected_term: ReturnType<typeof extractProtectedTermCandidates>
}

// Deterministic-extraction-assisted fixture creation (§22): proposes candidates from the frozen
// source's own text. Terminology (and claim_relationship) have no extractor: they need curation.
export function scanSourceForCandidates(sourceText: string): FixtureCandidates {
  return {
    citation: extractCitationCandidates(sourceText),
    numeric_unit: extractNumericUnitCandidates(sourceText),
    modality: extractModalityCandidates(sourceText),
    protected_term: extractProtectedTermCandidates(sourceText),
  }
}

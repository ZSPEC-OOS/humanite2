import { describe, it, expect } from 'vitest'
import type { Firestore } from 'firebase-admin/firestore'
import type OpenAI from 'openai'
import {
  createFixtureSet, getFixtureSet, listFixtureSetsForProject,
  createFixture, updateFixture, deleteFixture,
  listFixturesForSource, listFixturesForSet,
  validateFixtureSet, lockFixtureSet,
} from '../fixtures'
import { createCorpusProject, updateProjectDraft, lockBlueprint, freezeCorpusProject } from '../corpusProject'
import { createTopic, listTopics } from '../topics'
import type { CreateTopicInput } from '../topics'
import { generateSource, freezeSource } from '../corpus'
import { createRun, updateRunDraft, validateRun } from '../runs'
import { A2H_COLLECTIONS } from '../types'

function makeFirestore() {
  const collections = new Map<string, Map<string, Record<string, unknown>>>()
  let counter = 0

  function docsFor(name: string) {
    if (!collections.has(name)) collections.set(name, new Map())
    return collections.get(name)!
  }

  function docRef(name: string, id: string) {
    const docs = docsFor(name)
    return {
      id,
      get: async () => ({ exists: docs.has(id), data: () => docs.get(id) }),
      set: async (data: Record<string, unknown>) => { docs.set(id, data) },
      update: async (patch: Record<string, unknown>) => { docs.set(id, { ...(docs.get(id) ?? {}), ...patch }) },
      delete: async () => { docs.delete(id) },
    }
  }

  function makeQuery(name: string, predicate: (d: Record<string, unknown>) => boolean) {
    return {
      where: (field: string, _op: string, value: unknown) => makeQuery(name, d => predicate(d) && d[field] === value),
      get: async () => ({ docs: [...docsFor(name).values()].filter(predicate).map(data => ({ data: () => data })) }),
    }
  }

  function collection(name: string) {
    return {
      doc: (id?: string) => docRef(name, id ?? `auto-${++counter}`),
      where: (field: string, _op: string, value: unknown) => makeQuery(name, d => d[field] === value),
      get: async () => ({ docs: [...docsFor(name).values()].map(data => ({ data: () => data })) }),
    }
  }

  return { firestore: { collection } as unknown as Firestore }
}

function stubClient(content: string): OpenAI {
  return { chat: { completions: { create: async () => ({ choices: [{ message: { content } }] }) } } } as unknown as OpenAI
}
function words(n: number): string {
  return Array(n).fill('word').join(' ')
}

async function buildFrozenSource(firestore: Firestore): Promise<{ projectId: string; sourceId: string }> {
  const project = await createCorpusProject(firestore, { name: 'Fixture Test Corpus' })
  await updateProjectDraft(firestore, project.id, { domains: ['medical'], topicCountDefault: 1, lengthLadder: [100] })
  const topic = await createTopic(firestore, {
    corpusProjectId: project.id, domainId: 'medical', topicNumber: 1, title: 'T1', description: 'd',
    intendedAudience: 'a', writingType: 'w', coreConcepts: ['c'], generationPromptVersion: 'GEN-V001',
  } as CreateTopicInput)
  await lockBlueprint(firestore, project.id)
  const source = await generateSource(firestore, {
    corpusProjectId: project.id, topic, targetWords: 100, temperature: null,
    client: stubClient(words(100)), model: 'stub', providerLabel: 'openai',
  })
  await freezeSource(firestore, project.id, topic.id, 100)
  await freezeCorpusProject(firestore, project.id)
  return { projectId: project.id, sourceId: source.id }
}

const CITATION_EXPECTED = { kind: 'numeric', exactText: '[1]', normalizedText: '[1]' }

describe('createFixtureSet / versioning', () => {
  it('assigns FIXTURE-V001 to the first fixture set for a project', async () => {
    const { firestore } = makeFirestore()
    const { projectId } = await buildFrozenSource(firestore)
    const set = await createFixtureSet(firestore, { corpusProjectId: projectId, name: 'Fixtures' })
    expect(set.fixtureVersion).toBe('FIXTURE-V001')
    expect(set.status).toBe('draft')
  })

  it('assigns FIXTURE-V002 to a second fixture set for the same project — both coexist', async () => {
    const { firestore } = makeFirestore()
    const { projectId } = await buildFrozenSource(firestore)
    const v1 = await createFixtureSet(firestore, { corpusProjectId: projectId, name: 'V1' })
    const v2 = await createFixtureSet(firestore, { corpusProjectId: projectId, name: 'V2 (corrected)' })
    expect(v2.fixtureVersion).toBe('FIXTURE-V002')

    const both = await listFixtureSetsForProject(firestore, projectId)
    expect(both.map(s => s.id).sort()).toEqual([v1.id, v2.id].sort())
  })

  it('throws for a nonexistent project', async () => {
    const { firestore } = makeFirestore()
    await expect(createFixtureSet(firestore, { corpusProjectId: 'missing', name: 'X' })).rejects.toThrow(/not found/i)
  })
})

describe('createFixture — ownership and immutability rules (§45)', () => {
  it('creates a fixture attached to a frozen source, auto-assigning ordinal', async () => {
    const { firestore } = makeFirestore()
    const { projectId, sourceId } = await buildFrozenSource(firestore)
    const set = await createFixtureSet(firestore, { corpusProjectId: projectId, name: 'Fixtures' })
    const fixture = await createFixture(firestore, { fixtureSetId: set.id, sourceId, type: 'citation', expected: CITATION_EXPECTED })
    expect(fixture.ordinal).toBe(0)
    expect(fixture.corpusProjectId).toBe(projectId)

    const second = await createFixture(firestore, { fixtureSetId: set.id, sourceId, type: 'citation', expected: { ...CITATION_EXPECTED, exactText: '[2]', normalizedText: '[2]' } })
    expect(second.ordinal).toBe(1)
  })

  it('rejects an invalid fixture shape', async () => {
    const { firestore } = makeFirestore()
    const { projectId, sourceId } = await buildFrozenSource(firestore)
    const set = await createFixtureSet(firestore, { corpusProjectId: projectId, name: 'Fixtures' })
    await expect(createFixture(firestore, { fixtureSetId: set.id, sourceId, type: 'citation', expected: { kind: 'bogus' } })).rejects.toThrow()
  })

  it('rejects a duplicate ordinal for the same source/type', async () => {
    const { firestore } = makeFirestore()
    const { projectId, sourceId } = await buildFrozenSource(firestore)
    const set = await createFixtureSet(firestore, { corpusProjectId: projectId, name: 'Fixtures' })
    await createFixture(firestore, { fixtureSetId: set.id, sourceId, type: 'citation', expected: CITATION_EXPECTED, ordinal: 0 })
    await expect(createFixture(firestore, { fixtureSetId: set.id, sourceId, type: 'citation', expected: CITATION_EXPECTED, ordinal: 0 })).rejects.toThrow(/ordinal/i)
  })

  it('a fixture cannot reference a source in another project', async () => {
    const { firestore } = makeFirestore()
    const { projectId } = await buildFrozenSource(firestore)
    const other = await buildFrozenSource(firestore)
    const set = await createFixtureSet(firestore, { corpusProjectId: projectId, name: 'Fixtures' })
    await expect(createFixture(firestore, { fixtureSetId: set.id, sourceId: other.sourceId, type: 'citation', expected: CITATION_EXPECTED }))
      .rejects.toThrow(/does not belong/i)
  })

  it('a fixture cannot reference a non-frozen source', async () => {
    const { firestore } = makeFirestore()
    const project = await createCorpusProject(firestore, { name: 'Draft Corpus' })
    await updateProjectDraft(firestore, project.id, { domains: ['medical'], topicCountDefault: 1, lengthLadder: [100] })
    const topic = await createTopic(firestore, {
      corpusProjectId: project.id, domainId: 'medical', topicNumber: 1, title: 'T1', description: 'd',
      intendedAudience: 'a', writingType: 'w', coreConcepts: ['c'], generationPromptVersion: 'GEN-V001',
    } as CreateTopicInput)
    await lockBlueprint(firestore, project.id)
    const source = await generateSource(firestore, {
      corpusProjectId: project.id, topic, targetWords: 100, temperature: null,
      client: stubClient(words(100)), model: 'stub', providerLabel: 'openai',
    })
    // Never frozen.
    const set = await createFixtureSet(firestore, { corpusProjectId: project.id, name: 'Fixtures' })
    await expect(createFixture(firestore, { fixtureSetId: set.id, sourceId: source.id, type: 'citation', expected: CITATION_EXPECTED }))
      .rejects.toThrow(/frozen/i)
  })
})

describe('validateFixtureSet / lockFixtureSet (§25-26, §45)', () => {
  it('validates successfully and reports coverage', async () => {
    const { firestore } = makeFirestore()
    const { projectId, sourceId } = await buildFrozenSource(firestore)
    const set = await createFixtureSet(firestore, { corpusProjectId: projectId, name: 'Fixtures' })
    await createFixture(firestore, { fixtureSetId: set.id, sourceId, type: 'citation', expected: CITATION_EXPECTED })

    const result = await validateFixtureSet(firestore, set.id)
    expect(result.ok).toBe(true)
    expect(result.coverage.totalFixtures).toBe(1)
    expect(result.coverage.byType.citation).toBe(1)
    expect(result.coverage.sourcesWithAnyFixture).toBe(1)

    const reloaded = await getFixtureSet(firestore, set.id)
    expect(reloaded?.status).toBe('validated')
  })

  it('fixture set cannot lock if invalid', async () => {
    const { firestore } = makeFirestore()
    const { projectId, sourceId } = await buildFrozenSource(firestore)
    const set = await createFixtureSet(firestore, { corpusProjectId: projectId, name: 'Fixtures' })
    await createFixture(firestore, { fixtureSetId: set.id, sourceId, type: 'citation', expected: CITATION_EXPECTED })

    // Simulate corruption bypassing createFixture's own validation, to
    // exercise validateFixtureSet/lockFixtureSet's independent re-check.
    await firestore.collection(A2H_COLLECTIONS.fixtures).doc('corrupt-1').set({
      id: 'corrupt-1', fixtureSetId: set.id, corpusProjectId: projectId, sourceId,
      type: 'citation', ordinal: 5, expected: { kind: 'not-a-real-kind' },
      sourceStart: null, sourceEnd: null, sourceText: null, notes: null,
      createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z',
    })

    const { set: stillOpen, result } = await lockFixtureSet(firestore, set.id)
    expect(result.ok).toBe(false)
    expect(stillOpen.status).not.toBe('locked')
  })

  it('locks a valid fixture set, making it immutable', async () => {
    const { firestore } = makeFirestore()
    const { projectId, sourceId } = await buildFrozenSource(firestore)
    const set = await createFixtureSet(firestore, { corpusProjectId: projectId, name: 'Fixtures' })
    const fixture = await createFixture(firestore, { fixtureSetId: set.id, sourceId, type: 'citation', expected: CITATION_EXPECTED })

    const { set: locked, result } = await lockFixtureSet(firestore, set.id)
    expect(result.ok).toBe(true)
    expect(locked.status).toBe('locked')
    expect(locked.lockedAt).not.toBeNull()

    await expect(updateFixture(firestore, fixture.id, { notes: 'edit attempt' })).rejects.toThrow(/locked/i)
    await expect(deleteFixture(firestore, fixture.id)).rejects.toThrow(/locked/i)
    await expect(createFixture(firestore, { fixtureSetId: set.id, sourceId, type: 'citation', expected: { ...CITATION_EXPECTED, exactText: '[9]', normalizedText: '[9]' } }))
      .rejects.toThrow(/locked/i)
  })

  it('does not require every source to have every fixture type', async () => {
    const { firestore } = makeFirestore()
    const { projectId, sourceId } = await buildFrozenSource(firestore)
    const set = await createFixtureSet(firestore, { corpusProjectId: projectId, name: 'Fixtures' })
    // Only a citation fixture — no numeric/modality/protected-term/terminology.
    await createFixture(firestore, { fixtureSetId: set.id, sourceId, type: 'citation', expected: CITATION_EXPECTED })
    const { result } = await lockFixtureSet(firestore, set.id)
    expect(result.ok).toBe(true)
  })
})

describe('Benchmark Run fixture-set snapshotting (§4, §45)', () => {
  async function lockedFixtureSetFor(firestore: Firestore, projectId: string, sourceId: string) {
    const set = await createFixtureSet(firestore, { corpusProjectId: projectId, name: 'Fixtures' })
    await createFixture(firestore, { fixtureSetId: set.id, sourceId, type: 'citation', expected: CITATION_EXPECTED })
    const { set: locked, result } = await lockFixtureSet(firestore, set.id)
    if (!result.ok) throw new Error(`Test setup: fixture set failed to lock: ${result.errors.join(', ')}`)
    return locked
  }

  it('a run cannot validate with an enabled fixture-backed test and no fixture set', async () => {
    const { firestore } = makeFirestore()
    const { projectId } = await buildFrozenSource(firestore)
    const run = await createRun(firestore, { corpusProjectId: projectId, name: 'Run', modelProvider: 'openai', model: 'gpt-4o-mini' })
    await updateRunDraft(firestore, run.id, { enabledTests: ['A2H-04'] })
    const { result } = await validateRun(firestore, run.id, { hasModelConfig: true, hasDetectorConfig: true })
    expect(result.ok).toBe(false)
    expect(result.errors.some(e => /fixture set/i.test(e))).toBe(true)
  })

  it('a run cannot validate against an unlocked fixture set', async () => {
    const { firestore } = makeFirestore()
    const { projectId, sourceId } = await buildFrozenSource(firestore)
    const draftSet = await createFixtureSet(firestore, { corpusProjectId: projectId, name: 'Draft Fixtures' })
    await createFixture(firestore, { fixtureSetId: draftSet.id, sourceId, type: 'citation', expected: CITATION_EXPECTED })

    const run = await createRun(firestore, { corpusProjectId: projectId, name: 'Run', modelProvider: 'openai', model: 'gpt-4o-mini' })
    await updateRunDraft(firestore, run.id, { enabledTests: ['A2H-04'], fixtureSetId: draftSet.id })
    const { result } = await validateRun(firestore, run.id, { hasModelConfig: true, hasDetectorConfig: true })
    expect(result.ok).toBe(false)
    expect(result.errors.some(e => /not locked/i.test(e))).toBe(true)
  })

  it('snapshots the locked fixture set/version at validation time', async () => {
    const { firestore } = makeFirestore()
    const { projectId, sourceId } = await buildFrozenSource(firestore)
    const locked = await lockedFixtureSetFor(firestore, projectId, sourceId)

    const run = await createRun(firestore, { corpusProjectId: projectId, name: 'Run', modelProvider: 'openai', model: 'gpt-4o-mini' })
    await updateRunDraft(firestore, run.id, { enabledTests: ['A2H-04'], fixtureSetId: locked.id })
    const { run: validated, result } = await validateRun(firestore, run.id, { hasModelConfig: true, hasDetectorConfig: true })
    expect(result.ok).toBe(true)
    expect(validated.fixtureSetId).toBe(locked.id)
    expect(validated.fixtureVersion).toBe('FIXTURE-V001')
  })

  it('Run A and Run B may reference different fixture versions of the same project', async () => {
    const { firestore } = makeFirestore()
    const { projectId, sourceId } = await buildFrozenSource(firestore)
    const v1 = await lockedFixtureSetFor(firestore, projectId, sourceId)
    const v2 = await lockedFixtureSetFor(firestore, projectId, sourceId)
    expect(v2.fixtureVersion).toBe('FIXTURE-V002')

    const runA = await createRun(firestore, { corpusProjectId: projectId, name: 'Run A', modelProvider: 'openai', model: 'gpt-4o-mini' })
    await updateRunDraft(firestore, runA.id, { enabledTests: ['A2H-04'], fixtureSetId: v1.id })
    const { run: validatedA } = await validateRun(firestore, runA.id, { hasModelConfig: true, hasDetectorConfig: true })

    const runB = await createRun(firestore, { corpusProjectId: projectId, name: 'Run B', modelProvider: 'openai', model: 'gpt-4o-mini' })
    await updateRunDraft(firestore, runB.id, { enabledTests: ['A2H-04'], fixtureSetId: v2.id })
    const { run: validatedB } = await validateRun(firestore, runB.id, { hasModelConfig: true, hasDetectorConfig: true })

    expect(validatedA.fixtureVersion).toBe('FIXTURE-V001')
    expect(validatedB.fixtureVersion).toBe('FIXTURE-V002')
  })
})

describe('listFixturesForSource / listFixturesForSet', () => {
  it('lists only fixtures for the given fixture set + source, sorted by ordinal', async () => {
    const { firestore } = makeFirestore()
    const { projectId, sourceId } = await buildFrozenSource(firestore)
    const set = await createFixtureSet(firestore, { corpusProjectId: projectId, name: 'Fixtures' })
    await createFixture(firestore, { fixtureSetId: set.id, sourceId, type: 'citation', expected: { ...CITATION_EXPECTED, exactText: '[2]', normalizedText: '[2]' }, ordinal: 1 })
    await createFixture(firestore, { fixtureSetId: set.id, sourceId, type: 'citation', expected: CITATION_EXPECTED, ordinal: 0 })

    const forSource = await listFixturesForSource(firestore, set.id, sourceId)
    expect(forSource.map(f => f.ordinal)).toEqual([0, 1])

    const forSet = await listFixturesForSet(firestore, set.id)
    expect(forSet).toHaveLength(2)
  })
})

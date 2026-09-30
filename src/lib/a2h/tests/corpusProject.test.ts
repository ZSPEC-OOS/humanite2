import { describe, it, expect } from 'vitest'
import type { Firestore } from 'firebase-admin/firestore'
import {
  validateProjectName, validateDomains, validateTopicCountByDomain, validateLengthLadder, validateIntensities,
  createCorpusProject, getCorpusProject, listCorpusProjects, updateProjectDraft,
  lockBlueprint, markGeneratingIfNeeded, freezeCorpusProject, archiveCorpusProject, duplicateCorpusProject,
} from '../corpusProject'
import { createTopic, listTopics } from '../topics'
import type { CreateTopicInput } from '../topics'

// A per-collection-name in-memory Firestore fake — corpusProject.ts touches
// a2hCorpusProjects directly and, via topics.ts, a2hTopics too (duplicate
// copies the topic roster), so these must stay in separate maps the way real
// Firestore collections are.
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

describe('validateProjectName', () => {
  it('rejects an empty or whitespace-only name', () => {
    expect(validateProjectName('')).toBeTruthy()
    expect(validateProjectName('   ')).toBeTruthy()
    expect(validateProjectName(undefined)).toBeTruthy()
  })

  it('rejects a name over 200 characters', () => {
    expect(validateProjectName('a'.repeat(201))).toBeTruthy()
  })

  it('accepts a normal name', () => {
    expect(validateProjectName('A2H Standard Research Corpus V1')).toBeNull()
  })
})

describe('validateDomains', () => {
  it('rejects an empty array or non-array', () => {
    expect(validateDomains([])).toHaveProperty('error')
    expect(validateDomains('medical')).toHaveProperty('error')
  })

  it('rejects an unknown domain', () => {
    expect(validateDomains(['medical', 'not-a-domain'])).toHaveProperty('error')
  })

  it('de-duplicates and accepts a valid list', () => {
    const result = validateDomains(['medical', 'legal', 'medical'])
    expect('domains' in result && result.domains.sort()).toEqual(['legal', 'medical'])
  })
})

describe('validateTopicCountByDomain', () => {
  it('rejects a non-object value', () => {
    expect(validateTopicCountByDomain(null, ['medical'])).toHaveProperty('error')
    expect(validateTopicCountByDomain('5', ['medical'])).toHaveProperty('error')
  })

  it('requires an entry for every selected domain, within 1..50', () => {
    expect(validateTopicCountByDomain({}, ['medical'])).toHaveProperty('error')
    expect(validateTopicCountByDomain({ medical: 0 }, ['medical'])).toHaveProperty('error')
    expect(validateTopicCountByDomain({ medical: 51 }, ['medical'])).toHaveProperty('error')
  })

  it('accepts a valid count per selected domain, ignoring domains not selected', () => {
    const result = validateTopicCountByDomain({ medical: 20, legal: 15 }, ['medical'])
    expect('topicCountByDomain' in result && result.topicCountByDomain).toEqual({ medical: 20 })
  })
})

describe('validateLengthLadder', () => {
  it('rejects an empty or non-array value', () => {
    expect(validateLengthLadder([])).toHaveProperty('error')
    expect(validateLengthLadder('100,200')).toHaveProperty('error')
  })

  it('rejects a non-positive or non-integer length', () => {
    expect(validateLengthLadder([100, 0])).toHaveProperty('error')
    expect(validateLengthLadder([100, -50])).toHaveProperty('error')
    expect(validateLengthLadder([100, 200.5])).toHaveProperty('error')
  })

  it('rejects duplicate values', () => {
    expect(validateLengthLadder([100, 200, 500, 500, 1000])).toHaveProperty('error')
  })

  it('sorts ascending', () => {
    const result = validateLengthLadder([500, 100, 1000])
    expect('lengthLadder' in result && result.lengthLadder).toEqual([100, 500, 1000])
  })
})

describe('validateIntensities', () => {
  it('rejects a value outside 1..10 or a duplicate', () => {
    expect(validateIntensities([0, 1])).toHaveProperty('error')
    expect(validateIntensities([1, 11])).toHaveProperty('error')
    expect(validateIntensities([1, 1])).toHaveProperty('error')
  })

  it('sorts ascending', () => {
    const result = validateIntensities([5, 1, 3])
    expect('intensities' in result && result.intensities).toEqual([1, 3, 5])
  })
})

describe('createCorpusProject', () => {
  it('starts in draft with every domain pre-selected and no topic counts or ladder yet', async () => {
    const { firestore } = makeFirestore()
    const project = await createCorpusProject(firestore, { name: 'A2H Standard Corpus' })
    expect(project.status).toBe('draft')
    expect(project.domains.length).toBe(6)
    expect(project.topicCountByDomain).toEqual({})
    expect(project.lengthLadder).toEqual([])
    expect(project.intensities.length).toBe(10)
    expect(project.frozenAt).toBeNull()
    expect(project.createdAt).toBe(project.updatedAt)
  })

  it('rejects an invalid name', async () => {
    const { firestore } = makeFirestore()
    await expect(createCorpusProject(firestore, { name: '   ' })).rejects.toThrow()
  })

  it('round-trips through getCorpusProject and appears in listCorpusProjects', async () => {
    const { firestore } = makeFirestore()
    const first = await createCorpusProject(firestore, { name: 'First' })
    const second = await createCorpusProject(firestore, { name: 'Second' })
    expect(await getCorpusProject(firestore, first.id)).toEqual(first)

    const listed = await listCorpusProjects(firestore)
    expect(listed.map(p => p.id)).toContain(first.id)
    expect(listed.map(p => p.id)).toContain(second.id)
  })
})

describe('updateProjectDraft', () => {
  it('throws for a nonexistent project', async () => {
    const { firestore } = makeFirestore()
    await expect(updateProjectDraft(firestore, 'missing', { name: 'X' })).rejects.toThrow(/not found/i)
  })

  it('throws once the project is no longer draft', async () => {
    const { firestore } = makeFirestore()
    const project = await createCorpusProject(firestore, { name: 'Test' })
    await updateProjectDraft(firestore, project.id, { domains: ['medical'], topicCountByDomain: { medical: 1 }, lengthLadder: [100] })
    await createTopic(firestore, {
      corpusProjectId: project.id, domainId: 'medical', topicNumber: 1, title: 'T', description: 'd',
      intendedAudience: 'a', writingType: 'w', coreConcepts: ['c'], generationPromptVersion: 'GEN-V001',
    } as CreateTopicInput)
    await lockBlueprint(firestore, project.id)

    await expect(updateProjectDraft(firestore, project.id, { name: 'New name' })).rejects.toThrow(/cannot edit configuration/i)
  })

  it('applies a valid patch and bumps updatedAt', async () => {
    const { firestore } = makeFirestore()
    const project = await createCorpusProject(firestore, { name: 'Test' })
    const updated = await updateProjectDraft(firestore, project.id, { name: 'Renamed', lengthLadder: [200, 100] })
    expect(updated.name).toBe('Renamed')
    expect(updated.lengthLadder).toEqual([100, 200])
    expect(updated.createdAt).toBe(project.createdAt)
  })

  it('drops topicCountByDomain entries for domains removed from the selection', async () => {
    const { firestore } = makeFirestore()
    const project = await createCorpusProject(firestore, { name: 'Test' })
    await updateProjectDraft(firestore, project.id, { domains: ['medical', 'legal', 'general'] })
    await updateProjectDraft(firestore, project.id, { topicCountByDomain: { medical: 10, legal: 5, general: 8 } })
    const shrunk = await updateProjectDraft(firestore, project.id, { domains: ['medical', 'legal'] })
    expect(shrunk.topicCountByDomain).toEqual({ medical: 10, legal: 5 })
  })

  it('propagates a validation error for an invalid field without partially applying the patch', async () => {
    const { firestore } = makeFirestore()
    const project = await createCorpusProject(firestore, { name: 'Test' })
    await expect(updateProjectDraft(firestore, project.id, { name: 'Valid', lengthLadder: [100, 100] })).rejects.toThrow(/duplicate/i)
    const reloaded = await getCorpusProject(firestore, project.id)
    expect(reloaded?.name).toBe('Test')
  })
})

async function buildLockableProject(firestore: Firestore): Promise<string> {
  const project = await createCorpusProject(firestore, { name: 'Lockable' })
  await updateProjectDraft(firestore, project.id, {
    domains: ['medical'],
    topicCountByDomain: { medical: 2 },
    lengthLadder: [100, 200],
  })
  await createTopic(firestore, {
    corpusProjectId: project.id, domainId: 'medical', topicNumber: 1, title: 'T1', description: 'd',
    intendedAudience: 'a', writingType: 'w', coreConcepts: ['c'], generationPromptVersion: 'GEN-V001',
  } as CreateTopicInput)
  await createTopic(firestore, {
    corpusProjectId: project.id, domainId: 'medical', topicNumber: 2, title: 'T2', description: 'd',
    intendedAudience: 'a', writingType: 'w', coreConcepts: ['c'], generationPromptVersion: 'GEN-V001',
  } as CreateTopicInput)
  return project.id
}

describe('lockBlueprint', () => {
  it('throws for a nonexistent project', async () => {
    const { firestore } = makeFirestore()
    await expect(lockBlueprint(firestore, 'missing')).rejects.toThrow(/not found/i)
  })

  it('throws when the project is not draft', async () => {
    const { firestore } = makeFirestore()
    const id = await buildLockableProject(firestore)
    await lockBlueprint(firestore, id)
    await expect(lockBlueprint(firestore, id)).rejects.toThrow(/already/i)
  })

  it('throws when a domain has not generated its full configured topic count', async () => {
    const { firestore } = makeFirestore()
    const project = await createCorpusProject(firestore, { name: 'Incomplete' })
    await updateProjectDraft(firestore, project.id, { domains: ['medical'], topicCountByDomain: { medical: 5 }, lengthLadder: [100] })
    await createTopic(firestore, {
      corpusProjectId: project.id, domainId: 'medical', topicNumber: 1, title: 'T1', description: 'd',
      intendedAudience: 'a', writingType: 'w', coreConcepts: ['c'], generationPromptVersion: 'GEN-V001',
    } as CreateTopicInput)

    await expect(lockBlueprint(firestore, project.id)).rejects.toThrow(/1 of 5 topics generated/i)
  })

  it('locks a fully-generated blueprint', async () => {
    const { firestore } = makeFirestore()
    const id = await buildLockableProject(firestore)
    const locked = await lockBlueprint(firestore, id)
    expect(locked.status).toBe('blueprint_locked')
  })
})

describe('markGeneratingIfNeeded', () => {
  it('transitions blueprint_locked to generating', async () => {
    const { firestore } = makeFirestore()
    const id = await buildLockableProject(firestore)
    await lockBlueprint(firestore, id)
    await markGeneratingIfNeeded(firestore, id)
    expect((await getCorpusProject(firestore, id))?.status).toBe('generating')
  })

  it('is a no-op for any other status', async () => {
    const { firestore } = makeFirestore()
    const id = await buildLockableProject(firestore)
    await markGeneratingIfNeeded(firestore, id)
    expect((await getCorpusProject(firestore, id))?.status).toBe('draft')
  })
})

describe('freezeCorpusProject', () => {
  it('throws for a nonexistent project', async () => {
    const { firestore } = makeFirestore()
    await expect(freezeCorpusProject(firestore, 'missing')).rejects.toThrow(/not found/i)
  })

  it('throws when the project is still draft', async () => {
    const { firestore } = makeFirestore()
    const id = await buildLockableProject(firestore)
    await expect(freezeCorpusProject(firestore, id)).rejects.toThrow(/lock the blueprint/i)
  })

  it('freezes a blueprint_locked or generating project and sets frozenAt', async () => {
    const { firestore } = makeFirestore()
    const id = await buildLockableProject(firestore)
    await lockBlueprint(firestore, id)
    const frozen = await freezeCorpusProject(firestore, id)
    expect(frozen.status).toBe('frozen')
    expect(frozen.frozenAt).not.toBeNull()
  })
})

describe('archiveCorpusProject', () => {
  it('archives from any status', async () => {
    const { firestore } = makeFirestore()
    const project = await createCorpusProject(firestore, { name: 'Test' })
    const archived = await archiveCorpusProject(firestore, project.id)
    expect(archived.status).toBe('archived')
  })

  it('throws for a nonexistent project', async () => {
    const { firestore } = makeFirestore()
    await expect(archiveCorpusProject(firestore, 'missing')).rejects.toThrow(/not found/i)
  })
})

describe('duplicateCorpusProject', () => {
  it('copies configuration and the topic roster into a new project starting at draft', async () => {
    const { firestore } = makeFirestore()
    const id = await buildLockableProject(firestore)
    await lockBlueprint(firestore, id)

    const copy = await duplicateCorpusProject(firestore, id, 'Duplicate of Lockable')
    expect(copy.id).not.toBe(id)
    expect(copy.name).toBe('Duplicate of Lockable')
    expect(copy.status).toBe('draft')
    expect(copy.frozenAt).toBeNull()
    expect(copy.domains).toEqual(['medical'])
    expect(copy.topicCountByDomain).toEqual({ medical: 2 })
    expect(copy.lengthLadder).toEqual([100, 200])

    const copiedTopics = await listTopics(firestore, copy.id)
    expect(copiedTopics).toHaveLength(2)
    expect(copiedTopics.every(t => t.corpusProjectId === copy.id)).toBe(true)
    expect(copiedTopics.map(t => t.title).sort()).toEqual(['T1', 'T2'])
    // The source project's own topics are untouched — never re-parented.
    expect(await listTopics(firestore, id)).toHaveLength(2)
  })

  it('throws for a nonexistent source project', async () => {
    const { firestore } = makeFirestore()
    await expect(duplicateCorpusProject(firestore, 'missing', 'Copy')).rejects.toThrow(/not found/i)
  })

  it('rejects an invalid new name', async () => {
    const { firestore } = makeFirestore()
    const project = await createCorpusProject(firestore, { name: 'Test' })
    await expect(duplicateCorpusProject(firestore, project.id, '   ')).rejects.toThrow()
  })
})

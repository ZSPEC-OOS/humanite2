import { describe, it, expect } from 'vitest'
import type { Firestore } from 'firebase-admin/firestore'
import { DEFAULT_LENGTH_LADDER, TOPICS_PER_DOMAIN } from '../types'
import {
  validateProjectName, validateDomains, validateTopicCountDefault, validateTopicCountOverrides, validateLengthLadder,
  resolveTopicCountByDomain,
  createCorpusProject, getCorpusProject, listCorpusProjects, updateProjectDraft,
  lockBlueprint, markGeneratingIfNeeded, validateCorpusForFreeze, freezeCorpusProject, getCorpusManifest,
  archiveCorpusProject, duplicateCorpusProject,
} from '../corpusProject'
import { generateSource, freezeSource } from '../corpus'
import { createTopic, listTopics } from '../topics'
import type { CreateTopicInput } from '../topics'
import type OpenAI from 'openai'

// A per-collection-name in-memory Firestore fake — corpusProject.ts touches
// a2hCorpusProjects directly and, via topics.ts, a2hTopics too (duplicate
// copies the topic roster; freeze validation reads a2hCorpusSources), so
// these must stay in separate maps the way real Firestore collections are.
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
  return {
    chat: { completions: { create: async () => ({ choices: [{ message: { content } }] }) } },
  } as unknown as OpenAI
}
function words(n: number): string {
  return Array(n).fill('word').join(' ')
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

describe('validateTopicCountDefault', () => {
  it('rejects a value outside 1..50', () => {
    expect(validateTopicCountDefault(0)).toHaveProperty('error')
    expect(validateTopicCountDefault(51)).toHaveProperty('error')
    expect(validateTopicCountDefault('not a number')).toHaveProperty('error')
  })

  it('accepts a valid default', () => {
    const result = validateTopicCountDefault(20)
    expect('topicCountDefault' in result && result.topicCountDefault).toBe(20)
  })
})

describe('validateTopicCountOverrides', () => {
  it('rejects a non-object value', () => {
    expect(validateTopicCountOverrides(null, ['medical'])).toHaveProperty('error')
    expect(validateTopicCountOverrides('5', ['medical'])).toHaveProperty('error')
  })

  it('rejects an override for a domain that is not selected', () => {
    expect(validateTopicCountOverrides({ legal: 10 }, ['medical'])).toHaveProperty('error')
  })

  it('rejects an out-of-range override', () => {
    expect(validateTopicCountOverrides({ medical: 0 }, ['medical'])).toHaveProperty('error')
    expect(validateTopicCountOverrides({ medical: 51 }, ['medical'])).toHaveProperty('error')
  })

  it('accepts an empty object — overrides are optional', () => {
    const result = validateTopicCountOverrides({}, ['medical'])
    expect('topicCountOverrides' in result && result.topicCountOverrides).toEqual({})
  })

  it('accepts a valid override for a selected domain', () => {
    const result = validateTopicCountOverrides({ medical: 30 }, ['medical', 'legal'])
    expect('topicCountOverrides' in result && result.topicCountOverrides).toEqual({ medical: 30 })
  })
})

describe('resolveTopicCountByDomain', () => {
  it('uses the default for every domain with no override', () => {
    expect(resolveTopicCountByDomain(['medical', 'legal'], 20, {})).toEqual({ medical: 20, legal: 20 })
  })

  it('lets an explicit override win over the default', () => {
    expect(resolveTopicCountByDomain(['medical', 'legal'], 20, { medical: 30 })).toEqual({ medical: 30, legal: 20 })
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

describe('createCorpusProject', () => {
  it('starts in draft with the standard six-domain, 20-topic, 10-length A2H defaults', async () => {
    const { firestore } = makeFirestore()
    const project = await createCorpusProject(firestore, { name: 'A2H Standard Corpus' })
    expect(project.status).toBe('draft')
    expect(project.domains.length).toBe(6)
    expect(project.topicCountDefault).toBe(TOPICS_PER_DOMAIN)
    expect(project.topicCountDefault).toBe(20)
    expect(project.topicCountOverrides).toEqual({})
    for (const d of project.domains) expect(project.topicCountByDomain[d]).toBe(20)
    expect(project.lengthLadder).toEqual([...DEFAULT_LENGTH_LADDER])
    expect(project.lengthLadder).toEqual([100, 200, 300, 500, 750, 1000, 1250, 1500, 1750, 2000])
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
    await updateProjectDraft(firestore, project.id, { domains: ['medical'], topicCountDefault: 1, lengthLadder: [100] })
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

  it('raising the shared default propagates to every domain without its own override', async () => {
    const { firestore } = makeFirestore()
    const project = await createCorpusProject(firestore, { name: 'Test' })
    await updateProjectDraft(firestore, project.id, { domains: ['medical', 'legal', 'general'], topicCountOverrides: { legal: 15 } })
    const updated = await updateProjectDraft(firestore, project.id, { topicCountDefault: 30 })
    expect(updated.topicCountByDomain).toEqual({ medical: 30, legal: 15, general: 30 })
  })

  it('a domain override survives a later reload, independent of the default', async () => {
    const { firestore } = makeFirestore()
    const project = await createCorpusProject(firestore, { name: 'Test' })
    await updateProjectDraft(firestore, project.id, { domains: ['medical', 'legal'], topicCountOverrides: { medical: 40 } })
    const reloaded = await getCorpusProject(firestore, project.id)
    expect(reloaded?.topicCountOverrides).toEqual({ medical: 40 })
    expect(reloaded?.topicCountByDomain).toEqual({ medical: 40, legal: TOPICS_PER_DOMAIN })
  })

  it('resetting an override (omitting it from the patch) falls back to the default', async () => {
    const { firestore } = makeFirestore()
    const project = await createCorpusProject(firestore, { name: 'Test' })
    await updateProjectDraft(firestore, project.id, { domains: ['medical', 'legal'], topicCountOverrides: { medical: 40 } })
    const reset = await updateProjectDraft(firestore, project.id, { topicCountOverrides: {} })
    expect(reset.topicCountOverrides).toEqual({})
    expect(reset.topicCountByDomain).toEqual({ medical: TOPICS_PER_DOMAIN, legal: TOPICS_PER_DOMAIN })
  })

  it('drops overrides for domains removed from the selection', async () => {
    const { firestore } = makeFirestore()
    const project = await createCorpusProject(firestore, { name: 'Test' })
    await updateProjectDraft(firestore, project.id, { domains: ['medical', 'legal', 'general'], topicCountOverrides: { medical: 10, legal: 5, general: 8 } })
    const shrunk = await updateProjectDraft(firestore, project.id, { domains: ['medical', 'legal'] })
    expect(shrunk.topicCountOverrides).toEqual({ medical: 10, legal: 5 })
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
    topicCountDefault: 2,
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
    await updateProjectDraft(firestore, project.id, { domains: ['medical'], topicCountDefault: 5, lengthLadder: [100] })
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

// Freezes two topics x [100, 200] = 4 cells for a locked project, letting
// each test decide how many of those 4 make it all the way to frozen.
async function freezeAllCells(firestore: Firestore, projectId: string, topicIds: string[], lengths: number[]): Promise<void> {
  for (const topicId of topicIds) {
    for (const targetWords of lengths) {
      await generateSource(firestore, {
        corpusProjectId: projectId,
        topic: { id: topicId, corpusProjectId: projectId, domainId: 'medical', topicNumber: 1, title: 't', description: 'd', intendedAudience: 'a', writingType: 'w', coreConcepts: ['c'], generationPromptVersion: 'GEN-V001', enabled: true, createdAt: '', updatedAt: '' },
        targetWords,
        temperature: null,
        client: stubClient(words(targetWords)),
        model: 'stub',
        providerLabel: 'openai',
      })
      await freezeSource(firestore, projectId, topicId, targetWords)
    }
  }
}

describe('validateCorpusForFreeze', () => {
  it('reports every expected cell missing for a freshly-locked project with no sources yet', async () => {
    const { firestore } = makeFirestore()
    const id = await buildLockableProject(firestore)
    await lockBlueprint(firestore, id)
    const project = await getCorpusProject(firestore, id)
    const validation = await validateCorpusForFreeze(firestore, project!)
    expect(validation.ok).toBe(false)
    expect(validation.expectedSourceCount).toBe(4) // 2 topics x 2 lengths
    expect(validation.missingCells).toHaveLength(4)
  })

  it('is ok once every expected cell is frozen', async () => {
    const { firestore } = makeFirestore()
    const id = await buildLockableProject(firestore)
    await lockBlueprint(firestore, id)
    const topics = await listTopics(firestore, id, 'medical')
    await freezeAllCells(firestore, id, topics.map(t => t.id), [100, 200])

    const project = await getCorpusProject(firestore, id)
    const validation = await validateCorpusForFreeze(firestore, project!)
    expect(validation.ok).toBe(true)
    expect(validation.frozenCount).toBe(4)
    expect(validation.missingCells).toHaveLength(0)
  })

  it('is not ok when a source exists but is only validated, not frozen', async () => {
    const { firestore } = makeFirestore()
    const id = await buildLockableProject(firestore)
    await lockBlueprint(firestore, id)
    const topics = await listTopics(firestore, id, 'medical')
    // Freeze 3 of the 4 expected cells; leave the 4th generated but not frozen.
    await freezeAllCells(firestore, id, [topics[0]!.id], [100, 200])
    await generateSource(firestore, {
      corpusProjectId: id,
      topic: { id: topics[1]!.id, corpusProjectId: id, domainId: 'medical', topicNumber: 2, title: 't2', description: 'd', intendedAudience: 'a', writingType: 'w', coreConcepts: ['c'], generationPromptVersion: 'GEN-V001', enabled: true, createdAt: '', updatedAt: '' },
      targetWords: 100,
      temperature: null,
      client: stubClient(words(100)),
      model: 'stub',
      providerLabel: 'openai',
    })
    await freezeSource(firestore, id, topics[1]!.id, 100)
    await generateSource(firestore, {
      corpusProjectId: id,
      topic: { id: topics[1]!.id, corpusProjectId: id, domainId: 'medical', topicNumber: 2, title: 't2', description: 'd', intendedAudience: 'a', writingType: 'w', coreConcepts: ['c'], generationPromptVersion: 'GEN-V001', enabled: true, createdAt: '', updatedAt: '' },
      targetWords: 200,
      temperature: null,
      client: stubClient(words(200)),
      model: 'stub',
      providerLabel: 'openai',
    })
    // topics[1] @ 200 stays 'validated' — never frozen.

    const project = await getCorpusProject(firestore, id)
    const validation = await validateCorpusForFreeze(firestore, project!)
    expect(validation.ok).toBe(false)
    expect(validation.validatedNotFrozenCount).toBe(1)
    expect(validation.frozenCount).toBe(3)
    expect(validation.missingCells).toHaveLength(0)
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

  it('fails if even one expected source is missing', async () => {
    const { firestore } = makeFirestore()
    const id = await buildLockableProject(firestore)
    await lockBlueprint(firestore, id)
    const topics = await listTopics(firestore, id, 'medical')
    // Freeze only 3 of the 4 expected cells.
    await freezeAllCells(firestore, id, [topics[0]!.id], [100, 200])
    await generateSource(firestore, {
      corpusProjectId: id,
      topic: { id: topics[1]!.id, corpusProjectId: id, domainId: 'medical', topicNumber: 2, title: 't2', description: 'd', intendedAudience: 'a', writingType: 'w', coreConcepts: ['c'], generationPromptVersion: 'GEN-V001', enabled: true, createdAt: '', updatedAt: '' },
      targetWords: 100,
      temperature: null,
      client: stubClient(words(100)),
      model: 'stub',
      providerLabel: 'openai',
    })
    await freezeSource(firestore, id, topics[1]!.id, 100)
    // topics[1] @ 200 words is left entirely missing.

    await expect(freezeCorpusProject(firestore, id)).rejects.toThrow(/cannot freeze corpus/i)
    expect((await getCorpusProject(firestore, id))?.status).not.toBe('frozen')
  })

  it('fails if a source is validated but not yet frozen', async () => {
    const { firestore } = makeFirestore()
    const id = await buildLockableProject(firestore)
    await lockBlueprint(firestore, id)
    const topics = await listTopics(firestore, id, 'medical')
    await freezeAllCells(firestore, id, topics.map(t => t.id), [100, 200])
    // Generate a replacement source directly in the fake store's collection,
    // bypassing corpus.ts's own frozen-immutability guard, to simulate a
    // cell that regressed to validated-but-not-frozen — the state
    // freezeCorpusProject must still catch regardless of how it arose.
    await firestore.collection('a2hCorpusSources').doc(`${id}__${topics[0]!.id}__100`).update({ status: 'validated', frozenAt: null })

    await expect(freezeCorpusProject(firestore, id)).rejects.toThrow(/cannot freeze corpus/i)
  })

  it('succeeds only once the whole matrix is frozen, and writes an immutable manifest', async () => {
    const { firestore } = makeFirestore()
    const id = await buildLockableProject(firestore)
    await lockBlueprint(firestore, id)
    const topics = await listTopics(firestore, id, 'medical')
    await freezeAllCells(firestore, id, topics.map(t => t.id), [100, 200])

    const frozen = await freezeCorpusProject(firestore, id)
    expect(frozen.status).toBe('frozen')
    expect(frozen.frozenAt).not.toBeNull()

    const manifest = await getCorpusManifest(firestore, id)
    expect(manifest).not.toBeNull()
    expect(manifest?.corpusProjectId).toBe(id)
    expect(manifest?.expectedSourceCount).toBe(4)
    expect(manifest?.actualSourceCount).toBe(4)
    expect(Object.keys(manifest?.sourceHashes ?? {})).toHaveLength(4)
    expect(manifest?.manifestHash).toHaveLength(64)
  })

  it('a frozen project can never generate another source, even with force', async () => {
    const { firestore } = makeFirestore()
    const id = await buildLockableProject(firestore)
    await lockBlueprint(firestore, id)
    const topics = await listTopics(firestore, id, 'medical')
    await freezeAllCells(firestore, id, topics.map(t => t.id), [100, 200])
    await freezeCorpusProject(firestore, id)

    await expect(generateSource(firestore, {
      corpusProjectId: id,
      topic: { id: topics[0]!.id, corpusProjectId: id, domainId: 'medical', topicNumber: 1, title: 't', description: 'd', intendedAudience: 'a', writingType: 'w', coreConcepts: ['c'], generationPromptVersion: 'GEN-V001', enabled: true, createdAt: '', updatedAt: '' },
      targetWords: 100,
      temperature: null,
      client: stubClient(words(100)),
      model: 'stub',
      providerLabel: 'openai',
    }, true)).rejects.toThrow(/must not yet be frozen/i)
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
  it('copies configuration (including default/overrides) and the topic roster into a new project starting at draft', async () => {
    const { firestore } = makeFirestore()
    const id = await buildLockableProject(firestore)
    await lockBlueprint(firestore, id)

    const copy = await duplicateCorpusProject(firestore, id, 'Duplicate of Lockable')
    expect(copy.id).not.toBe(id)
    expect(copy.name).toBe('Duplicate of Lockable')
    expect(copy.status).toBe('draft')
    expect(copy.frozenAt).toBeNull()
    expect(copy.domains).toEqual(['medical'])
    expect(copy.topicCountDefault).toBe(2)
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

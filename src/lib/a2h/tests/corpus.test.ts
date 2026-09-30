import { describe, it, expect } from 'vitest'
import type { Firestore } from 'firebase-admin/firestore'
import type OpenAI from 'openai'
import { generateSource, freezeSource, getSource, listSources } from '../corpus'
import type { BenchmarkTopic, CorpusProject } from '../types'

// A per-collection-name in-memory Firestore fake — generateSource reads from
// a2hCorpusProjects (via corpusProject.ts) and writes to a2hCorpusSources, so
// unlike a single flat map, this one must keep them separate the way real
// Firestore collections are.
function makeFirestore() {
  const collections = new Map<string, Map<string, Record<string, unknown>>>()

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
      doc: (id: string) => docRef(name, id),
      where: (field: string, _op: string, value: unknown) => makeQuery(name, d => d[field] === value),
    }
  }

  return { firestore: { collection } as unknown as Firestore }
}

function stubClient(content: string): OpenAI {
  return {
    chat: { completions: { create: async () => ({ choices: [{ message: { content } }] }) } },
  } as unknown as OpenAI
}

function makeProject(id: string, overrides: Partial<CorpusProject> = {}): CorpusProject {
  return {
    id,
    name: 'Test Project',
    benchmarkVersion: 'A2H-BV001',
    corpusVersion: 'CORPUS-V001',
    domains: ['general', 'legal'],
    topicCountDefault: 20,
    topicCountOverrides: {},
    topicCountByDomain: {},
    lengthLadder: [100, 200],
    status: 'blueprint_locked',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    frozenAt: null,
    ...overrides,
  }
}

// generateSource always looks the project up first, so every test needs one
// seeded directly (bypassing corpusProject.ts's own create/lock flow, which
// has its own test file) with whatever status/lengthLadder that test needs.
async function seedProject(firestore: Firestore, overrides: Partial<CorpusProject> = {}): Promise<string> {
  const id = (overrides.id as string) ?? 'project-1'
  await firestore.collection('a2hCorpusProjects').doc(id).set(makeProject(id, overrides))
  return id
}

function makeTopic(corpusProjectId: string, overrides: Partial<BenchmarkTopic> = {}): BenchmarkTopic {
  return {
    id: 'topic-1',
    corpusProjectId,
    domainId: 'general',
    topicNumber: 1,
    title: 'Test Topic',
    description: 'A test topic.',
    intendedAudience: 'general readers',
    writingType: 'article',
    coreConcepts: ['concept a', 'concept b'],
    generationPromptVersion: 'GEN-V001',
    enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function words(n: number): string {
  return Array(n).fill('word').join(' ')
}

describe('generateSource', () => {
  it('stores a validated source when the returned text lands within tolerance', async () => {
    const { firestore } = makeFirestore()
    const projectId = await seedProject(firestore)
    const topic = makeTopic(projectId)
    const source = await generateSource(firestore, {
      corpusProjectId: projectId,
      topic,
      targetWords: 100,
      temperature: null,
      client: stubClient(words(102)),
      model: 'stub-model',
      providerLabel: 'openai',
    })
    expect(source.status).toBe('validated')
    expect(source.actualWords).toBe(102)
    expect(source.sha256).toHaveLength(64)
    expect(source.domainId).toBe('general')
    expect(source.frozenAt).toBeNull()
    expect(source.corpusProjectId).toBe(projectId)
  })

  it('stores a validation_failed source when the word count is outside tolerance', async () => {
    const { firestore } = makeFirestore()
    const projectId = await seedProject(firestore)
    const topic = makeTopic(projectId)
    const source = await generateSource(firestore, {
      corpusProjectId: projectId, topic, targetWords: 100, temperature: null,
      client: stubClient(words(50)), model: 'stub-model', providerLabel: 'openai',
    })
    expect(source.status).toBe('validation_failed')
    expect(source.actualWords).toBe(50)
  })

  it('throws on empty generated text rather than persisting an empty source', async () => {
    const { firestore } = makeFirestore()
    const projectId = await seedProject(firestore)
    const topic = makeTopic(projectId)
    await expect(generateSource(firestore, {
      corpusProjectId: projectId, topic, targetWords: 100, temperature: null,
      client: stubClient('   '), model: 'stub-model', providerLabel: 'openai',
    })).rejects.toThrow(/empty/i)
  })

  it('throws when the corpus project does not exist', async () => {
    const { firestore } = makeFirestore()
    const topic = makeTopic('missing-project')
    await expect(generateSource(firestore, {
      corpusProjectId: 'missing-project', topic, targetWords: 100, temperature: null,
      client: stubClient(words(100)), model: 'stub-model', providerLabel: 'openai',
    })).rejects.toThrow(/not found/i)
  })

  it('refuses to generate while the project is still draft', async () => {
    const { firestore } = makeFirestore()
    const projectId = await seedProject(firestore, { status: 'draft' })
    const topic = makeTopic(projectId)
    await expect(generateSource(firestore, {
      corpusProjectId: projectId, topic, targetWords: 100, temperature: null,
      client: stubClient(words(100)), model: 'stub-model', providerLabel: 'openai',
    })).rejects.toThrow(/blueprint must be locked/i)
  })

  it('refuses to generate for an archived project', async () => {
    const { firestore } = makeFirestore()
    const projectId = await seedProject(firestore, { status: 'archived' })
    const topic = makeTopic(projectId)
    await expect(generateSource(firestore, {
      corpusProjectId: projectId, topic, targetWords: 100, temperature: null,
      client: stubClient(words(100)), model: 'stub-model', providerLabel: 'openai',
    })).rejects.toThrow(/archived/i)
  })

  it('rejects a targetWords value not on the project\'s length ladder', async () => {
    const { firestore } = makeFirestore()
    const projectId = await seedProject(firestore, { lengthLadder: [100, 200] })
    const topic = makeTopic(projectId)
    await expect(generateSource(firestore, {
      corpusProjectId: projectId, topic, targetWords: 999, temperature: null,
      client: stubClient(words(100)), model: 'stub-model', providerLabel: 'openai',
    })).rejects.toThrow(/targetWords must be one of/i)
  })

  it('refuses to silently overwrite an already-validated source', async () => {
    const { firestore } = makeFirestore()
    const projectId = await seedProject(firestore)
    const topic = makeTopic(projectId)
    await generateSource(firestore, {
      corpusProjectId: projectId, topic, targetWords: 100, temperature: null,
      client: stubClient(words(100)), model: 'stub-model', providerLabel: 'openai',
    })
    await expect(generateSource(firestore, {
      corpusProjectId: projectId, topic, targetWords: 100, temperature: null,
      client: stubClient(words(101)), model: 'stub-model', providerLabel: 'openai',
    })).rejects.toThrow(/already/i)
  })

  it('allows overwriting an already-validated source when forceOverwrite is set', async () => {
    const { firestore } = makeFirestore()
    const projectId = await seedProject(firestore)
    const topic = makeTopic(projectId)
    await generateSource(firestore, {
      corpusProjectId: projectId, topic, targetWords: 100, temperature: null,
      client: stubClient(words(100)), model: 'stub-model', providerLabel: 'openai',
    })
    const overwritten = await generateSource(firestore, {
      corpusProjectId: projectId, topic, targetWords: 100, temperature: null,
      client: stubClient(words(103)), model: 'stub-model', providerLabel: 'openai',
    }, true)
    expect(overwritten.actualWords).toBe(103)
  })

  it('always allows regenerating a validation_failed source without forceOverwrite', async () => {
    const { firestore } = makeFirestore()
    const projectId = await seedProject(firestore)
    const topic = makeTopic(projectId)
    await generateSource(firestore, {
      corpusProjectId: projectId, topic, targetWords: 100, temperature: null,
      client: stubClient(words(50)), model: 'stub-model', providerLabel: 'openai',
    })
    const retried = await generateSource(firestore, {
      corpusProjectId: projectId, topic, targetWords: 100, temperature: null,
      client: stubClient(words(100)), model: 'stub-model', providerLabel: 'openai',
    })
    expect(retried.status).toBe('validated')
  })

  it('marks the project as generating on the first successful source generation', async () => {
    const { firestore } = makeFirestore()
    const projectId = await seedProject(firestore, { status: 'blueprint_locked' })
    const topic = makeTopic(projectId)
    await generateSource(firestore, {
      corpusProjectId: projectId, topic, targetWords: 100, temperature: null,
      client: stubClient(words(100)), model: 'stub-model', providerLabel: 'openai',
    })
    const doc = await firestore.collection('a2hCorpusProjects').doc(projectId).get()
    expect((doc.data() as CorpusProject).status).toBe('generating')
  })

  it('never regenerates a frozen source, even with forceOverwrite — the project itself may still be generating', async () => {
    const { firestore } = makeFirestore()
    const projectId = await seedProject(firestore, { status: 'blueprint_locked' })
    const topic = makeTopic(projectId)
    await generateSource(firestore, {
      corpusProjectId: projectId, topic, targetWords: 100, temperature: null,
      client: stubClient(words(100)), model: 'stub-model', providerLabel: 'openai',
    })
    await freezeSource(firestore, projectId, topic.id, 100)

    await expect(generateSource(firestore, {
      corpusProjectId: projectId, topic, targetWords: 100, temperature: null,
      client: stubClient(words(105)), model: 'stub-model', providerLabel: 'openai',
    }, true)).rejects.toThrow(/immutable/i)

    const stillFrozen = await getSource(firestore, projectId, topic.id, 100)
    expect(stillFrozen?.status).toBe('frozen')
    expect(stillFrozen?.actualWords).toBe(100)
  })

  it('rejects a topic that does not belong to the given corpus project, even though both exist', async () => {
    const { firestore } = makeFirestore()
    const projectA = await seedProject(firestore, { id: 'project-a' })
    const projectB = await seedProject(firestore, { id: 'project-b' })
    const topicFromA = makeTopic(projectA)

    await expect(generateSource(firestore, {
      corpusProjectId: projectB, topic: topicFromA, targetWords: 100, temperature: null,
      client: stubClient(words(100)), model: 'stub-model', providerLabel: 'openai',
    })).rejects.toThrow(/does not belong to this corpus project/i)
  })
})

describe('freezeSource', () => {
  it('promotes a validated source to frozen and sets frozenAt', async () => {
    const { firestore } = makeFirestore()
    const projectId = await seedProject(firestore)
    const topic = makeTopic(projectId)
    await generateSource(firestore, {
      corpusProjectId: projectId, topic, targetWords: 100, temperature: null,
      client: stubClient(words(100)), model: 'stub-model', providerLabel: 'openai',
    })
    const frozen = await freezeSource(firestore, projectId, topic.id, 100)
    expect(frozen.status).toBe('frozen')
    expect(frozen.frozenAt).not.toBeNull()

    const refetched = await getSource(firestore, projectId, topic.id, 100)
    expect(refetched?.status).toBe('frozen')
  })

  it('refuses to freeze a source that does not exist', async () => {
    const { firestore } = makeFirestore()
    const projectId = await seedProject(firestore)
    await expect(freezeSource(firestore, projectId, 'topic-1', 100)).rejects.toThrow(/no source/i)
  })

  it('refuses to freeze a validation_failed source', async () => {
    const { firestore } = makeFirestore()
    const projectId = await seedProject(firestore)
    const topic = makeTopic(projectId)
    await generateSource(firestore, {
      corpusProjectId: projectId, topic, targetWords: 100, temperature: null,
      client: stubClient(words(50)), model: 'stub-model', providerLabel: 'openai',
    })
    await expect(freezeSource(firestore, projectId, topic.id, 100)).rejects.toThrow(/validation_failed/)
  })

  it('refuses to re-freeze an already-frozen source', async () => {
    const { firestore } = makeFirestore()
    const projectId = await seedProject(firestore)
    const topic = makeTopic(projectId)
    await generateSource(firestore, {
      corpusProjectId: projectId, topic, targetWords: 100, temperature: null,
      client: stubClient(words(100)), model: 'stub-model', providerLabel: 'openai',
    })
    await freezeSource(firestore, projectId, topic.id, 100)
    await expect(freezeSource(firestore, projectId, topic.id, 100)).rejects.toThrow(/frozen/)
  })
})

describe('listSources', () => {
  it('filters by corpusProjectId and optionally by domainId, never mixing across projects', async () => {
    const { firestore } = makeFirestore()
    const projectA = await seedProject(firestore, { id: 'project-a', lengthLadder: [100, 200] })
    const projectB = await seedProject(firestore, { id: 'project-b', lengthLadder: [100] })

    await generateSource(firestore, {
      corpusProjectId: projectA, topic: makeTopic(projectA), targetWords: 100, temperature: null,
      client: stubClient(words(100)), model: 'stub-model', providerLabel: 'openai',
    })
    await generateSource(firestore, {
      corpusProjectId: projectA, topic: makeTopic(projectA, { id: 'topic-2', domainId: 'legal' }), targetWords: 200, temperature: null,
      client: stubClient(words(200)), model: 'stub-model', providerLabel: 'openai',
    })
    await generateSource(firestore, {
      corpusProjectId: projectB, topic: makeTopic(projectB), targetWords: 100, temperature: null,
      client: stubClient(words(100)), model: 'stub-model', providerLabel: 'openai',
    })

    const aSources = await listSources(firestore, projectA)
    expect(aSources).toHaveLength(2)

    const aGeneral = await listSources(firestore, projectA, 'general')
    expect(aGeneral).toHaveLength(1)
    expect(aGeneral[0]?.topicId).toBe('topic-1')

    const bSources = await listSources(firestore, projectB)
    expect(bSources).toHaveLength(1)
    expect(bSources[0]?.corpusProjectId).toBe(projectB)
  })
})

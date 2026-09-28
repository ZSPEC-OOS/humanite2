import { describe, it, expect } from 'vitest'
import type { Firestore } from 'firebase-admin/firestore'
import type OpenAI from 'openai'
import { generateSource, freezeSource, getSource, listSources } from '../corpus'
import type { BenchmarkTopic } from '../types'

function makeFirestore() {
  const docs = new Map<string, Record<string, unknown>>()

  function docRef(id: string) {
    return {
      get: async () => ({ exists: docs.has(id), data: () => docs.get(id) }),
      set: async (data: Record<string, unknown>) => { docs.set(id, data) },
      update: async (patch: Record<string, unknown>) => { docs.set(id, { ...(docs.get(id) ?? {}), ...patch }) },
    }
  }

  function makeQuery(predicate: (d: Record<string, unknown>) => boolean) {
    return {
      where: (field: string, _op: string, value: unknown) => makeQuery(d => predicate(d) && d[field] === value),
      get: async () => ({ docs: [...docs.values()].filter(predicate).map(data => ({ data: () => data })) }),
    }
  }

  const collection = {
    doc: (id: string) => docRef(id),
    where: (field: string, _op: string, value: unknown) => makeQuery(d => d[field] === value),
  }

  const firestore = { collection: () => collection }
  return { firestore: firestore as unknown as Firestore, docs }
}

function stubClient(content: string): OpenAI {
  return {
    chat: { completions: { create: async () => ({ choices: [{ message: { content } }] }) } },
  } as unknown as OpenAI
}

const TOPIC: BenchmarkTopic = {
  id: 'topic-1',
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
}

function words(n: number): string {
  return Array(n).fill('word').join(' ')
}

describe('generateSource', () => {
  it('stores a validated source when the returned text lands within tolerance', async () => {
    const { firestore } = makeFirestore()
    const source = await generateSource(firestore, {
      corpusVersion: 'CORPUS-V001',
      topic: TOPIC,
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
  })

  it('stores a validation_failed source when the word count is outside tolerance', async () => {
    const { firestore } = makeFirestore()
    const source = await generateSource(firestore, {
      corpusVersion: 'CORPUS-V001',
      topic: TOPIC,
      targetWords: 100,
      temperature: null,
      client: stubClient(words(50)),
      model: 'stub-model',
      providerLabel: 'openai',
    })
    expect(source.status).toBe('validation_failed')
    expect(source.actualWords).toBe(50)
  })

  it('throws on empty generated text rather than persisting an empty source', async () => {
    const { firestore } = makeFirestore()
    await expect(generateSource(firestore, {
      corpusVersion: 'CORPUS-V001',
      topic: TOPIC,
      targetWords: 100,
      temperature: null,
      client: stubClient('   '),
      model: 'stub-model',
      providerLabel: 'openai',
    })).rejects.toThrow(/empty/i)
  })

  it('refuses to silently overwrite an already-validated source', async () => {
    const { firestore } = makeFirestore()
    await generateSource(firestore, {
      corpusVersion: 'CORPUS-V001', topic: TOPIC, targetWords: 100, temperature: null,
      client: stubClient(words(100)), model: 'stub-model', providerLabel: 'openai',
    })
    await expect(generateSource(firestore, {
      corpusVersion: 'CORPUS-V001', topic: TOPIC, targetWords: 100, temperature: null,
      client: stubClient(words(101)), model: 'stub-model', providerLabel: 'openai',
    })).rejects.toThrow(/already/i)
  })

  it('allows overwriting an already-validated source when forceOverwrite is set', async () => {
    const { firestore } = makeFirestore()
    await generateSource(firestore, {
      corpusVersion: 'CORPUS-V001', topic: TOPIC, targetWords: 100, temperature: null,
      client: stubClient(words(100)), model: 'stub-model', providerLabel: 'openai',
    })
    const overwritten = await generateSource(firestore, {
      corpusVersion: 'CORPUS-V001', topic: TOPIC, targetWords: 100, temperature: null,
      client: stubClient(words(103)), model: 'stub-model', providerLabel: 'openai',
    }, true)
    expect(overwritten.actualWords).toBe(103)
  })

  it('always allows regenerating a validation_failed source without forceOverwrite', async () => {
    const { firestore } = makeFirestore()
    await generateSource(firestore, {
      corpusVersion: 'CORPUS-V001', topic: TOPIC, targetWords: 100, temperature: null,
      client: stubClient(words(50)), model: 'stub-model', providerLabel: 'openai',
    })
    const retried = await generateSource(firestore, {
      corpusVersion: 'CORPUS-V001', topic: TOPIC, targetWords: 100, temperature: null,
      client: stubClient(words(100)), model: 'stub-model', providerLabel: 'openai',
    })
    expect(retried.status).toBe('validated')
  })
})

describe('freezeSource', () => {
  it('promotes a validated source to frozen and sets frozenAt', async () => {
    const { firestore } = makeFirestore()
    await generateSource(firestore, {
      corpusVersion: 'CORPUS-V001', topic: TOPIC, targetWords: 100, temperature: null,
      client: stubClient(words(100)), model: 'stub-model', providerLabel: 'openai',
    })
    const frozen = await freezeSource(firestore, 'CORPUS-V001', TOPIC.id, 100)
    expect(frozen.status).toBe('frozen')
    expect(frozen.frozenAt).not.toBeNull()

    const refetched = await getSource(firestore, 'CORPUS-V001', TOPIC.id, 100)
    expect(refetched?.status).toBe('frozen')
  })

  it('refuses to freeze a source that does not exist', async () => {
    const { firestore } = makeFirestore()
    await expect(freezeSource(firestore, 'CORPUS-V001', TOPIC.id, 100)).rejects.toThrow(/no source/i)
  })

  it('refuses to freeze a validation_failed source', async () => {
    const { firestore } = makeFirestore()
    await generateSource(firestore, {
      corpusVersion: 'CORPUS-V001', topic: TOPIC, targetWords: 100, temperature: null,
      client: stubClient(words(50)), model: 'stub-model', providerLabel: 'openai',
    })
    await expect(freezeSource(firestore, 'CORPUS-V001', TOPIC.id, 100)).rejects.toThrow(/validation_failed/)
  })

  it('refuses to re-freeze an already-frozen source', async () => {
    const { firestore } = makeFirestore()
    await generateSource(firestore, {
      corpusVersion: 'CORPUS-V001', topic: TOPIC, targetWords: 100, temperature: null,
      client: stubClient(words(100)), model: 'stub-model', providerLabel: 'openai',
    })
    await freezeSource(firestore, 'CORPUS-V001', TOPIC.id, 100)
    await expect(freezeSource(firestore, 'CORPUS-V001', TOPIC.id, 100)).rejects.toThrow(/frozen/)
  })
})

describe('listSources', () => {
  it('filters by corpusVersion and optionally by domainId', async () => {
    const { firestore } = makeFirestore()
    await generateSource(firestore, {
      corpusVersion: 'CORPUS-V001', topic: TOPIC, targetWords: 100, temperature: null,
      client: stubClient(words(100)), model: 'stub-model', providerLabel: 'openai',
    })
    await generateSource(firestore, {
      corpusVersion: 'CORPUS-V001', topic: { ...TOPIC, id: 'topic-2', domainId: 'legal' }, targetWords: 200, temperature: null,
      client: stubClient(words(200)), model: 'stub-model', providerLabel: 'openai',
    })
    await generateSource(firestore, {
      corpusVersion: 'CORPUS-V002', topic: TOPIC, targetWords: 100, temperature: null,
      client: stubClient(words(100)), model: 'stub-model', providerLabel: 'openai',
    })

    const v1 = await listSources(firestore, 'CORPUS-V001')
    expect(v1).toHaveLength(2)

    const v1General = await listSources(firestore, 'CORPUS-V001', 'general')
    expect(v1General).toHaveLength(1)
    expect(v1General[0]?.topicId).toBe('topic-1')
  })
})

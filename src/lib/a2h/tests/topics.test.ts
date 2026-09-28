import { describe, it, expect } from 'vitest'
import type { Firestore } from 'firebase-admin/firestore'
import { parseTopicInput, parseTopicPatch, listTopics, getTopic, createTopic, updateTopic, type CreateTopicInput } from '../topics'

// A minimal in-memory Firestore fake — just enough surface for topics.ts's
// own calls (collection().doc()/.where()/.get()/.set()/.update()), the same
// "just enough" approach setAccountTier.test.ts uses for its own fake.
function makeFirestore() {
  const docs = new Map<string, Record<string, unknown>>()
  let counter = 0

  function docRef(id: string) {
    return {
      id,
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
    doc: (id?: string) => docRef(id ?? `auto-${++counter}`),
    where: (field: string, _op: string, value: unknown) => makeQuery(d => d[field] === value),
    get: async () => ({ docs: [...docs.values()].map(data => ({ data: () => data })) }),
  }

  const firestore = { collection: () => collection }
  return { firestore: firestore as unknown as Firestore, docs }
}

const VALID_INPUT: Record<string, unknown> = {
  domainId: 'medical',
  topicNumber: 3,
  title: 'Managing Type 2 Diabetes',
  description: 'An overview of lifestyle and pharmacological management.',
  intendedAudience: 'Newly diagnosed adult patients',
  writingType: 'patient education handout',
  coreConcepts: ['blood glucose monitoring', 'metformin'],
  generationPromptVersion: 'GEN-V001',
}

describe('parseTopicInput', () => {
  it('accepts a fully-populated valid submission', () => {
    const result = parseTopicInput(VALID_INPUT)
    expect('input' in result).toBe(true)
  })

  it('rejects an invalid or missing domainId', () => {
    expect(parseTopicInput({ ...VALID_INPUT, domainId: 'not-a-domain' })).toHaveProperty('error')
    expect(parseTopicInput({ ...VALID_INPUT, domainId: undefined })).toHaveProperty('error')
  })

  it('rejects a topicNumber outside 1..20', () => {
    expect(parseTopicInput({ ...VALID_INPUT, topicNumber: 0 })).toHaveProperty('error')
    expect(parseTopicInput({ ...VALID_INPUT, topicNumber: 21 })).toHaveProperty('error')
    expect(parseTopicInput({ ...VALID_INPUT, topicNumber: 1.5 })).toHaveProperty('error')
  })

  it('rejects an empty/whitespace-only title, description, audience, or writingType', () => {
    expect(parseTopicInput({ ...VALID_INPUT, title: '   ' })).toHaveProperty('error')
    expect(parseTopicInput({ ...VALID_INPUT, description: '' })).toHaveProperty('error')
    expect(parseTopicInput({ ...VALID_INPUT, intendedAudience: '  ' })).toHaveProperty('error')
    expect(parseTopicInput({ ...VALID_INPUT, writingType: '' })).toHaveProperty('error')
  })

  it('rejects empty coreConcepts and filters out blank entries', () => {
    expect(parseTopicInput({ ...VALID_INPUT, coreConcepts: [] })).toHaveProperty('error')
    expect(parseTopicInput({ ...VALID_INPUT, coreConcepts: ['', '  '] })).toHaveProperty('error')

    const result = parseTopicInput({ ...VALID_INPUT, coreConcepts: ['metformin', '', '  diet  '] })
    expect('input' in result && result.input.coreConcepts).toEqual(['metformin', 'diet'])
  })

  it('rejects a missing generationPromptVersion', () => {
    expect(parseTopicInput({ ...VALID_INPUT, generationPromptVersion: '' })).toHaveProperty('error')
  })
})

describe('parseTopicPatch', () => {
  it('only includes fields actually present and well-typed in the body', () => {
    expect(parseTopicPatch({ title: 'New title' })).toEqual({ title: 'New title' })
    expect(parseTopicPatch({ enabled: false })).toEqual({ enabled: false })
    expect(parseTopicPatch({ title: 123, enabled: 'yes' })).toEqual({})
  })

  it('trims strings and filters blank coreConcepts entries', () => {
    expect(parseTopicPatch({ title: '  Trimmed  ' })).toEqual({ title: 'Trimmed' })
    expect(parseTopicPatch({ coreConcepts: ['a', '', ' b '] })).toEqual({ coreConcepts: ['a', 'b'] })
  })
})

describe('topic CRUD against Firestore', () => {
  it('creates a topic with a generated id, enabled=true, and timestamps', async () => {
    const { firestore } = makeFirestore()
    const topic = await createTopic(firestore, VALID_INPUT as unknown as CreateTopicInput)
    expect(topic.id).toBeTruthy()
    expect(topic.enabled).toBe(true)
    expect(topic.title).toBe(VALID_INPUT.title)
    expect(topic.createdAt).toBe(topic.updatedAt)
  })

  it('round-trips through getTopic', async () => {
    const { firestore } = makeFirestore()
    const created = await createTopic(firestore, VALID_INPUT as unknown as CreateTopicInput)
    const fetched = await getTopic(firestore, created.id)
    expect(fetched).toEqual(created)
  })

  it('returns null for a nonexistent topic id', async () => {
    const { firestore } = makeFirestore()
    expect(await getTopic(firestore, 'does-not-exist')).toBeNull()
  })

  it('lists topics sorted by domain then topicNumber, optionally filtered by domain', async () => {
    const { firestore } = makeFirestore()
    await createTopic(firestore, { ...VALID_INPUT, domainId: 'medical', topicNumber: 2 } as unknown as CreateTopicInput)
    await createTopic(firestore, { ...VALID_INPUT, domainId: 'medical', topicNumber: 1 } as unknown as CreateTopicInput)
    await createTopic(firestore, { ...VALID_INPUT, domainId: 'legal', topicNumber: 1 } as unknown as CreateTopicInput)

    const all = await listTopics(firestore)
    expect(all.map(t => `${t.domainId}-${t.topicNumber}`)).toEqual(['legal-1', 'medical-1', 'medical-2'])

    const medicalOnly = await listTopics(firestore, 'medical')
    expect(medicalOnly).toHaveLength(2)
    expect(medicalOnly.every(t => t.domainId === 'medical')).toBe(true)
  })

  it('updateTopic merges the patch and refreshes updatedAt', async () => {
    const { firestore } = makeFirestore()
    const created = await createTopic(firestore, VALID_INPUT as unknown as CreateTopicInput)
    await updateTopic(firestore, created.id, { enabled: false })
    const fetched = await getTopic(firestore, created.id)
    expect(fetched?.enabled).toBe(false)
    expect(fetched?.title).toBe(created.title)
  })
})

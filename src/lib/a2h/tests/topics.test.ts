import { describe, it, expect } from 'vitest'
import type { Firestore } from 'firebase-admin/firestore'
import { parseTopicInput, parseTopicPatch, listTopics, getTopic, createTopic, updateTopic, deleteTopicsForDomain, type CreateTopicInput } from '../topics'

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
      delete: async () => { docs.delete(id) },
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

const PROJECT_A = 'project-a'
const PROJECT_B = 'project-b'

const VALID_INPUT: Record<string, unknown> = {
  corpusProjectId: PROJECT_A,
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

  it('rejects a topicNumber outside 1..50 (the sanity ceiling, independent of any domain\'s own configured count)', () => {
    expect(parseTopicInput({ ...VALID_INPUT, topicNumber: 0 })).toHaveProperty('error')
    expect(parseTopicInput({ ...VALID_INPUT, topicNumber: 51 })).toHaveProperty('error')
    expect(parseTopicInput({ ...VALID_INPUT, topicNumber: 1.5 })).toHaveProperty('error')
  })

  it('accepts a topicNumber above the old fixed-20 default, since a domain can be configured with a larger count', () => {
    expect(parseTopicInput({ ...VALID_INPUT, topicNumber: 21 })).toHaveProperty('input')
    expect(parseTopicInput({ ...VALID_INPUT, topicNumber: 50 })).toHaveProperty('input')
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

  it('does not include corpusProjectId in the parsed input — the route supplies it separately', () => {
    const result = parseTopicInput(VALID_INPUT)
    expect('input' in result && result.input).not.toHaveProperty('corpusProjectId')
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
    expect(topic.corpusProjectId).toBe(PROJECT_A)
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

    const all = await listTopics(firestore, PROJECT_A)
    expect(all.map(t => `${t.domainId}-${t.topicNumber}`)).toEqual(['legal-1', 'medical-1', 'medical-2'])

    const medicalOnly = await listTopics(firestore, PROJECT_A, 'medical')
    expect(medicalOnly).toHaveLength(2)
    expect(medicalOnly.every(t => t.domainId === 'medical')).toBe(true)
  })

  it('never mixes topics belonging to different corpus projects', async () => {
    const { firestore } = makeFirestore()
    await createTopic(firestore, { ...VALID_INPUT, corpusProjectId: PROJECT_A, domainId: 'medical', topicNumber: 1 } as unknown as CreateTopicInput)
    await createTopic(firestore, { ...VALID_INPUT, corpusProjectId: PROJECT_B, domainId: 'medical', topicNumber: 1 } as unknown as CreateTopicInput)

    expect(await listTopics(firestore, PROJECT_A)).toHaveLength(1)
    expect(await listTopics(firestore, PROJECT_B)).toHaveLength(1)
    expect((await listTopics(firestore, PROJECT_A))[0]?.corpusProjectId).toBe(PROJECT_A)
  })

  it('updateTopic merges the patch and refreshes updatedAt', async () => {
    const { firestore } = makeFirestore()
    const created = await createTopic(firestore, VALID_INPUT as unknown as CreateTopicInput)
    await updateTopic(firestore, created.id, { enabled: false })
    const fetched = await getTopic(firestore, created.id)
    expect(fetched?.enabled).toBe(false)
    expect(fetched?.title).toBe(created.title)
  })

  it('deleteTopicsForDomain removes only that project\'s domain topics', async () => {
    const { firestore } = makeFirestore()
    await createTopic(firestore, { ...VALID_INPUT, corpusProjectId: PROJECT_A, domainId: 'medical', topicNumber: 1 } as unknown as CreateTopicInput)
    await createTopic(firestore, { ...VALID_INPUT, corpusProjectId: PROJECT_A, domainId: 'medical', topicNumber: 2 } as unknown as CreateTopicInput)
    await createTopic(firestore, { ...VALID_INPUT, corpusProjectId: PROJECT_A, domainId: 'legal', topicNumber: 1 } as unknown as CreateTopicInput)
    await createTopic(firestore, { ...VALID_INPUT, corpusProjectId: PROJECT_B, domainId: 'medical', topicNumber: 1 } as unknown as CreateTopicInput)

    await deleteTopicsForDomain(firestore, PROJECT_A, 'medical')

    expect(await listTopics(firestore, PROJECT_A, 'medical')).toHaveLength(0)
    expect(await listTopics(firestore, PROJECT_A, 'legal')).toHaveLength(1)
    // A same-domain topic belonging to a different project is untouched.
    expect(await listTopics(firestore, PROJECT_B, 'medical')).toHaveLength(1)
  })
})

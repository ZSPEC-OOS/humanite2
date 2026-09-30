import { describe, it, expect } from 'vitest'
import type { Firestore } from 'firebase-admin/firestore'
import type OpenAI from 'openai'
import { buildOutlinePrompt, outlineMaxTokensFor, parseOutlineResponse, generateOutline } from '../outlineGeneration'
import { lockDomainTopicCount } from '../domainConfig'
import { listTopics, createTopic } from '../topics'
import type { CreateTopicInput } from '../topics'

// A per-collection-name in-memory Firestore fake — outlineGeneration.ts
// touches both a2hDomainConfigs (via domainConfig.ts) and a2hTopics (via
// topics.ts), so unlike a single-collection fake, this one must keep them
// separate the way real Firestore collections are.
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

function validOutlineJson(count: number): string {
  return JSON.stringify({
    topics: Array.from({ length: count }, (_, i) => ({
      title: `Topic ${i + 1}`,
      writingType: 'Clinical overview',
      description: 'A one-sentence description.',
      intendedAudience: 'Clinicians',
      coreConcepts: ['causes', 'symptoms', 'diagnosis', 'treatment'],
    })),
  })
}

describe('buildOutlinePrompt', () => {
  it('includes the domain and the requested topic count', () => {
    const prompt = buildOutlinePrompt('medical', 20)
    expect(prompt).toContain('medical')
    expect(prompt).toContain('20')
    expect(prompt).toContain('"topics"')
  })
})

describe('outlineMaxTokensFor', () => {
  it('scales with topic count and caps at 8192', () => {
    expect(outlineMaxTokensFor(5)).toBeLessThan(outlineMaxTokensFor(50))
    expect(outlineMaxTokensFor(1000)).toBe(8192)
  })
})

describe('parseOutlineResponse', () => {
  it('parses a fully valid response', () => {
    const raw = JSON.parse(validOutlineJson(3))
    const result = parseOutlineResponse(raw, 3)
    expect('topics' in result && result.topics).toHaveLength(3)
  })

  it('errors when the response has no "topics" array', () => {
    expect(parseOutlineResponse({ foo: 'bar' }, 3)).toHaveProperty('error')
    expect(parseOutlineResponse(null, 3)).toHaveProperty('error')
    expect(parseOutlineResponse('not an object', 3)).toHaveProperty('error')
  })

  it('skips malformed entries but keeps valid ones', () => {
    const raw = {
      topics: [
        { title: 'Valid', writingType: 'Overview', description: 'desc', intendedAudience: 'aud', coreConcepts: ['a', 'b'] },
        { title: '', writingType: 'Overview', description: 'desc', intendedAudience: 'aud', coreConcepts: ['a'] },
        { title: 'Missing concepts', writingType: 'Overview', description: 'desc', intendedAudience: 'aud', coreConcepts: [] },
        'not an object',
      ],
    }
    const result = parseOutlineResponse(raw, 1)
    expect('topics' in result && result.topics).toHaveLength(1)
    expect('topics' in result && result.topics[0]?.title).toBe('Valid')
  })

  it('errors when fewer valid topics survive than requested', () => {
    const raw = { topics: [{ title: 'Only one', writingType: 'Overview', description: 'd', intendedAudience: 'a', coreConcepts: ['x'] }] }
    expect(parseOutlineResponse(raw, 3)).toHaveProperty('error')
  })

  it('trims to topicCount when the model returns more than requested', () => {
    const raw = JSON.parse(validOutlineJson(5))
    const result = parseOutlineResponse(raw, 3)
    expect('topics' in result && result.topics).toHaveLength(3)
  })
})

describe('generateOutline', () => {
  it('throws when the domain has no locked topic-count configuration', async () => {
    const { firestore } = makeFirestore()
    await expect(generateOutline(firestore, { domainId: 'medical', client: stubClient(validOutlineJson(20)), model: 'stub' }))
      .rejects.toThrow(/lock a topic count/i)
  })

  it('creates exactly topicCount topics numbered 1..N when the domain is locked and empty', async () => {
    const { firestore } = makeFirestore()
    await lockDomainTopicCount(firestore, 'medical', 5)

    const created = await generateOutline(firestore, { domainId: 'medical', client: stubClient(validOutlineJson(5)), model: 'stub' })
    expect(created).toHaveLength(5)
    expect(created.map(t => t.topicNumber).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5])
    expect(created.every(t => t.domainId === 'medical')).toBe(true)

    const stored = await listTopics(firestore, 'medical')
    expect(stored).toHaveLength(5)
  })

  it('refuses to regenerate over existing topics without force', async () => {
    const { firestore } = makeFirestore()
    await lockDomainTopicCount(firestore, 'medical', 2)
    await createTopic(firestore, {
      domainId: 'medical', topicNumber: 1, title: 'Existing', description: 'd', intendedAudience: 'a',
      writingType: 'w', coreConcepts: ['c'], generationPromptVersion: 'GEN-V001',
    } as CreateTopicInput)

    await expect(generateOutline(firestore, { domainId: 'medical', client: stubClient(validOutlineJson(2)), model: 'stub' }))
      .rejects.toThrow(/already exist/i)
  })

  it('replaces existing topics when force is set', async () => {
    const { firestore } = makeFirestore()
    await lockDomainTopicCount(firestore, 'medical', 2)
    await createTopic(firestore, {
      domainId: 'medical', topicNumber: 1, title: 'Old topic', description: 'd', intendedAudience: 'a',
      writingType: 'w', coreConcepts: ['c'], generationPromptVersion: 'GEN-V001',
    } as CreateTopicInput)

    const regenerated = await generateOutline(
      firestore, { domainId: 'medical', client: stubClient(validOutlineJson(2)), model: 'stub' }, true,
    )
    expect(regenerated).toHaveLength(2)
    const stored = await listTopics(firestore, 'medical')
    expect(stored).toHaveLength(2)
    expect(stored.every(t => t.title !== 'Old topic')).toBe(true)
  })

  it('throws when the model does not return valid JSON', async () => {
    const { firestore } = makeFirestore()
    await lockDomainTopicCount(firestore, 'medical', 5)
    await expect(generateOutline(firestore, { domainId: 'medical', client: stubClient('not json'), model: 'stub' }))
      .rejects.toThrow(/valid json/i)
  })

  it('throws when the model returns fewer valid topics than the locked count, without persisting anything', async () => {
    const { firestore } = makeFirestore()
    await lockDomainTopicCount(firestore, 'medical', 5)
    await expect(generateOutline(firestore, { domainId: 'medical', client: stubClient(validOutlineJson(2)), model: 'stub' }))
      .rejects.toThrow(/requested 5/)
    expect(await listTopics(firestore, 'medical')).toHaveLength(0)
  })
})

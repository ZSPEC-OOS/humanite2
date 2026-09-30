import { describe, it, expect, vi } from 'vitest'
import type { Firestore } from 'firebase-admin/firestore'
import type OpenAI from 'openai'
import {
  buildOutlinePrompt, buildExpandPrompt, outlineMaxTokensFor, parseOutlineResponse,
  normalizeTopicTitle, generateOutline, expandOutline,
} from '../outlineGeneration'
import { lockDomainTopicCount, raiseDomainTopicCount } from '../domainConfig'
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

function stubClientWithOptions(
  content: string,
  opts: { finishReason?: string; baseURL?: string } = {},
): { client: OpenAI; create: ReturnType<typeof vi.fn> } {
  const create = vi.fn().mockResolvedValue({
    choices: [{ message: { content }, finish_reason: opts.finishReason ?? 'stop' }],
  })
  return { client: { baseURL: opts.baseURL, chat: { completions: { create } } } as unknown as OpenAI, create }
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

function outlineJsonFromTitles(titles: string[]): string {
  return JSON.stringify({
    topics: titles.map(title => ({
      title,
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

describe('normalizeTopicTitle', () => {
  it('collapses case, punctuation, and whitespace differences to the same key', () => {
    expect(normalizeTopicTitle('Hypertension')).toBe(normalizeTopicTitle('hypertension'))
    expect(normalizeTopicTitle('Hypertension')).toBe(normalizeTopicTitle('Hypertension.'))
    expect(normalizeTopicTitle('Type 2  Diabetes')).toBe(normalizeTopicTitle('type 2 diabetes'))
  })

  it('does not collapse genuinely different titles', () => {
    expect(normalizeTopicTitle('Type 2 Diabetes')).not.toBe(normalizeTopicTitle('Type 1 Diabetes'))
  })
})

describe('outlineMaxTokensFor', () => {
  it('scales with topic count and caps at 16384', () => {
    expect(outlineMaxTokensFor(5)).toBeLessThan(outlineMaxTokensFor(50))
    expect(outlineMaxTokensFor(1000)).toBe(16384)
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

  it('rejects an internally duplicated title — case/punctuation-insensitive', () => {
    const raw = JSON.parse(outlineJsonFromTitles(['Hypertension', 'Asthma', 'hypertension.']))
    const result = parseOutlineResponse(raw, 3)
    expect(result).toHaveProperty('error')
    expect('error' in result && result.error).toMatch(/duplicate/i)
  })

  it('rejects a title that duplicates an existing topic already in the roster', () => {
    const raw = JSON.parse(outlineJsonFromTitles(['Asthma', 'Migraine']))
    const result = parseOutlineResponse(raw, 2, ['Hypertension', 'ASTHMA'])
    expect(result).toHaveProperty('error')
    expect('error' in result && result.error).toMatch(/duplicates an existing topic/i)
  })

  it('accepts distinct titles against a non-overlapping existing roster', () => {
    const raw = JSON.parse(outlineJsonFromTitles(['Asthma', 'Migraine']))
    const result = parseOutlineResponse(raw, 2, ['Hypertension', 'Diabetes'])
    expect('topics' in result && result.topics).toHaveLength(2)
  })
})

describe('buildExpandPrompt', () => {
  it('lists the existing titles and requests the additional count', () => {
    const prompt = buildExpandPrompt('medical', 10, ['Hypertension', 'Asthma'])
    expect(prompt).toContain('10 additional')
    expect(prompt).toContain('Hypertension')
    expect(prompt).toContain('Asthma')
    expect(prompt).toMatch(/do not repeat/i)
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

  it('throws when the model does not return valid JSON, including a snippet of the actual response', async () => {
    const { firestore } = makeFirestore()
    await lockDomainTopicCount(firestore, 'medical', 5)
    await expect(generateOutline(firestore, { domainId: 'medical', client: stubClient('Sorry, I cannot help with that.'), model: 'stub' }))
      .rejects.toThrow(/Sorry, I cannot help with that/)
  })

  it('throws when the model returns fewer valid topics than the locked count, without persisting anything', async () => {
    const { firestore } = makeFirestore()
    await lockDomainTopicCount(firestore, 'medical', 5)
    await expect(generateOutline(firestore, { domainId: 'medical', client: stubClient(validOutlineJson(2)), model: 'stub' }))
      .rejects.toThrow(/requested 5/)
    expect(await listTopics(firestore, 'medical')).toHaveLength(0)
  })
})

describe('generateOutline — response robustness', () => {
  it('parses a response wrapped in a markdown code fence despite the prompt asking for plain JSON', async () => {
    const { firestore } = makeFirestore()
    await lockDomainTopicCount(firestore, 'medical', 3)
    const fenced = '```json\n' + validOutlineJson(3) + '\n```'
    const { client } = stubClientWithOptions(fenced)
    const created = await generateOutline(firestore, { domainId: 'medical', client, model: 'stub' })
    expect(created).toHaveLength(3)
  })

  it('falls back to extracting the first balanced {...} block when the content has surrounding prose', async () => {
    const { firestore } = makeFirestore()
    await lockDomainTopicCount(firestore, 'medical', 3)
    const { client } = stubClientWithOptions(`Sure, here is the JSON you asked for:\n${validOutlineJson(3)}\nLet me know if you need anything else!`)
    const created = await generateOutline(firestore, { domainId: 'medical', client, model: 'stub' })
    expect(created).toHaveLength(3)
  })

  it('omits response_format when the resolved provider has no JSON-mode capability', async () => {
    const { firestore } = makeFirestore()
    await lockDomainTopicCount(firestore, 'medical', 3)
    const { client, create } = stubClientWithOptions(validOutlineJson(3), { baseURL: 'https://unrecognized-endpoint.example.com/v1' })
    await generateOutline(firestore, { domainId: 'medical', client, model: 'stub' })
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty('response_format')
  })

  it('includes response_format for a known JSON-capable provider', async () => {
    const { firestore } = makeFirestore()
    await lockDomainTopicCount(firestore, 'medical', 3)
    const { client, create } = stubClientWithOptions(validOutlineJson(3), { baseURL: 'https://api.openai.com/v1' })
    await generateOutline(firestore, { domainId: 'medical', client, model: 'stub' })
    expect(create.mock.calls[0]?.[0]).toMatchObject({ response_format: { type: 'json_object' } })
  })

  it('throws a specific, actionable error when the response was cut off by the token limit', async () => {
    const { firestore } = makeFirestore()
    await lockDomainTopicCount(firestore, 'medical', 5)
    const { client } = stubClientWithOptions('{"topics": [{"title": "Incomple', { finishReason: 'length' })
    await expect(generateOutline(firestore, { domainId: 'medical', client, model: 'stub' }))
      .rejects.toThrow(/cut off before completing/i)
  })
})

describe('expandOutline', () => {
  it('throws when the domain has no locked topic-count configuration', async () => {
    const { firestore } = makeFirestore()
    await expect(expandOutline(firestore, { domainId: 'medical', client: stubClient(validOutlineJson(5)), model: 'stub' }))
      .rejects.toThrow(/lock a topic count/i)
  })

  it('throws when no topics exist yet — generateOutline is the initial-roster path', async () => {
    const { firestore } = makeFirestore()
    await lockDomainTopicCount(firestore, 'medical', 20)
    await expect(expandOutline(firestore, { domainId: 'medical', client: stubClient(validOutlineJson(20)), model: 'stub' }))
      .rejects.toThrow(/no topics exist yet/i)
  })

  it('throws when the locked count has not actually been raised past the existing roster', async () => {
    const { firestore } = makeFirestore()
    await lockDomainTopicCount(firestore, 'medical', 2)
    await generateOutline(firestore, { domainId: 'medical', client: stubClient(validOutlineJson(2)), model: 'stub' })
    await expect(expandOutline(firestore, { domainId: 'medical', client: stubClient(validOutlineJson(2)), model: 'stub' }))
      .rejects.toThrow(/meets or exceeds/i)
  })

  it('appends only the additional topics needed, leaving the existing roster untouched', async () => {
    const { firestore } = makeFirestore()
    await lockDomainTopicCount(firestore, 'medical', 2)
    const initial = await generateOutline(firestore, { domainId: 'medical', client: stubClient(validOutlineJson(2)), model: 'stub' })
    await raiseDomainTopicCount(firestore, 'medical', 5)

    const additionalJson = outlineJsonFromTitles(['New Topic A', 'New Topic B', 'New Topic C'])
    const appended = await expandOutline(firestore, { domainId: 'medical', client: stubClient(additionalJson), model: 'stub' })

    expect(appended).toHaveLength(3)
    expect(appended.map(t => t.topicNumber).sort((a, b) => a - b)).toEqual([3, 4, 5])

    const stored = await listTopics(firestore, 'medical')
    expect(stored).toHaveLength(5)
    // The original two topics are byte-for-byte the same records — never
    // regenerated by expandOutline.
    for (const original of initial) {
      expect(stored.find(t => t.id === original.id)).toEqual(original)
    }
  })

  it('rejects an additional topic that duplicates one already in the roster', async () => {
    const { firestore } = makeFirestore()
    await lockDomainTopicCount(firestore, 'medical', 1)
    await generateOutline(firestore, { domainId: 'medical', client: stubClient(outlineJsonFromTitles(['Hypertension'])), model: 'stub' })
    await raiseDomainTopicCount(firestore, 'medical', 2)

    await expect(expandOutline(firestore, { domainId: 'medical', client: stubClient(outlineJsonFromTitles(['hypertension'])), model: 'stub' }))
      .rejects.toThrow(/duplicates an existing topic/i)

    expect(await listTopics(firestore, 'medical')).toHaveLength(1)
  })
})

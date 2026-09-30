import { describe, it, expect } from 'vitest'
import type { Firestore } from 'firebase-admin/firestore'
import { createTopicChecked, updateTopicChecked } from '../topicMutations'
import { createCorpusProject, updateProjectDraft, lockBlueprint } from '../corpusProject'
import { createTopic, getTopic } from '../topics'
import type { CreateTopicInput } from '../topics'

// A per-collection-name in-memory Firestore fake, matching corpusProject.ts's
// and outlineGeneration.ts's own test fakes — createTopicChecked/
// updateTopicChecked touch both a2hCorpusProjects and a2hTopics.
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

const VALID_INPUT = {
  domainId: 'medical' as const,
  topicNumber: 1,
  title: 'Managing Type 2 Diabetes',
  description: 'An overview of lifestyle and pharmacological management.',
  intendedAudience: 'Newly diagnosed adult patients',
  writingType: 'patient education handout',
  coreConcepts: ['blood glucose monitoring', 'metformin'],
  generationPromptVersion: 'GEN-V001',
}

describe('createTopicChecked', () => {
  it('fails for a nonexistent project', async () => {
    const { firestore } = makeFirestore()
    await expect(createTopicChecked(firestore, 'missing', VALID_INPUT)).rejects.toThrow(/not found/i)
  })

  it('fails for a non-draft project', async () => {
    const { firestore } = makeFirestore()
    const project = await createCorpusProject(firestore, { name: 'Test' })
    await updateProjectDraft(firestore, project.id, { domains: ['medical'], topicCountDefault: 1, lengthLadder: [100] })
    await createTopic(firestore, { ...VALID_INPUT, corpusProjectId: project.id } as CreateTopicInput)
    await lockBlueprint(firestore, project.id)

    await expect(createTopicChecked(firestore, project.id, { ...VALID_INPUT, title: 'Something else' })).rejects.toThrow(/not draft/i)
  })

  it('fails for a domain that is not selected in the project', async () => {
    const { firestore } = makeFirestore()
    const project = await createCorpusProject(firestore, { name: 'Test' })
    await updateProjectDraft(firestore, project.id, { domains: ['legal'] })

    await expect(createTopicChecked(firestore, project.id, VALID_INPUT)).rejects.toThrow(/not a selected domain/i)
  })

  it('fails when topicNumber exceeds the domain\'s configured count', async () => {
    const { firestore } = makeFirestore()
    const project = await createCorpusProject(firestore, { name: 'Test' })
    await updateProjectDraft(firestore, project.id, { domains: ['medical'], topicCountOverrides: { medical: 5 } })

    await expect(createTopicChecked(firestore, project.id, { ...VALID_INPUT, topicNumber: 6 })).rejects.toThrow(/topicNumber must be between 1 and 5/i)
  })

  it('fails for a duplicate project/domain/topicNumber', async () => {
    const { firestore } = makeFirestore()
    const project = await createCorpusProject(firestore, { name: 'Test' })
    await updateProjectDraft(firestore, project.id, { domains: ['medical'] })
    await createTopicChecked(firestore, project.id, VALID_INPUT)

    await expect(createTopicChecked(firestore, project.id, { ...VALID_INPUT, title: 'A different title' }))
      .rejects.toThrow(/topic number 1 is already used/i)
  })

  it('fails for a duplicate normalized title within the same domain', async () => {
    const { firestore } = makeFirestore()
    const project = await createCorpusProject(firestore, { name: 'Test' })
    await updateProjectDraft(firestore, project.id, { domains: ['medical'] })
    await createTopicChecked(firestore, project.id, { ...VALID_INPUT, title: 'Hypertension' })

    await expect(createTopicChecked(firestore, project.id, { ...VALID_INPUT, topicNumber: 2, title: 'hypertension.' }))
      .rejects.toThrow(/already exists/i)
  })

  it('the same topic number and title are allowed again in a different project (no cross-project collision)', async () => {
    const { firestore } = makeFirestore()
    const projectA = await createCorpusProject(firestore, { name: 'A' })
    const projectB = await createCorpusProject(firestore, { name: 'B' })
    await updateProjectDraft(firestore, projectA.id, { domains: ['medical'] })
    await updateProjectDraft(firestore, projectB.id, { domains: ['medical'] })

    await createTopicChecked(firestore, projectA.id, VALID_INPUT)
    const topicB = await createTopicChecked(firestore, projectB.id, VALID_INPUT)
    expect(topicB.corpusProjectId).toBe(projectB.id)
  })

  it('succeeds for a valid submission within a draft project', async () => {
    const { firestore } = makeFirestore()
    const project = await createCorpusProject(firestore, { name: 'Test' })
    await updateProjectDraft(firestore, project.id, { domains: ['medical'] })

    const topic = await createTopicChecked(firestore, project.id, VALID_INPUT)
    expect(topic.corpusProjectId).toBe(project.id)
    expect(topic.title).toBe(VALID_INPUT.title)
  })
})

describe('updateTopicChecked', () => {
  it('fails for a nonexistent topic', async () => {
    const { firestore } = makeFirestore()
    await expect(updateTopicChecked(firestore, 'missing', { title: 'New' })).rejects.toThrow(/topic not found/i)
  })

  it('fails once the parent project is no longer draft — topics are immutable after lock', async () => {
    const { firestore } = makeFirestore()
    const project = await createCorpusProject(firestore, { name: 'Test' })
    await updateProjectDraft(firestore, project.id, { domains: ['medical'], topicCountDefault: 1, lengthLadder: [100] })
    const topic = await createTopicChecked(firestore, project.id, VALID_INPUT)
    await lockBlueprint(firestore, project.id)

    await expect(updateTopicChecked(firestore, topic.id, { title: 'Changed' })).rejects.toThrow(/not draft/i)
    await expect(updateTopicChecked(firestore, topic.id, { enabled: false })).rejects.toThrow(/not draft/i)

    const stillOriginal = await getTopic(firestore, topic.id)
    expect(stillOriginal?.title).toBe(VALID_INPUT.title)
    expect(stillOriginal?.enabled).toBe(true)
  })

  it('fails when the new title duplicates a sibling in the same domain', async () => {
    const { firestore } = makeFirestore()
    const project = await createCorpusProject(firestore, { name: 'Test' })
    await updateProjectDraft(firestore, project.id, { domains: ['medical'] })
    await createTopicChecked(firestore, project.id, { ...VALID_INPUT, title: 'Hypertension' })
    const second = await createTopicChecked(firestore, project.id, { ...VALID_INPUT, topicNumber: 2, title: 'Asthma' })

    await expect(updateTopicChecked(firestore, second.id, { title: 'hypertension' })).rejects.toThrow(/already exists/i)
  })

  it('succeeds for a valid edit while still draft', async () => {
    const { firestore } = makeFirestore()
    const project = await createCorpusProject(firestore, { name: 'Test' })
    await updateProjectDraft(firestore, project.id, { domains: ['medical'] })
    const topic = await createTopicChecked(firestore, project.id, VALID_INPUT)

    const updated = await updateTopicChecked(firestore, topic.id, { title: 'Renamed Topic' })
    expect(updated.title).toBe('Renamed Topic')
  })
})

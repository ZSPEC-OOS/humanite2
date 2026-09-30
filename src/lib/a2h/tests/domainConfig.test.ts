import { describe, it, expect } from 'vitest'
import type { Firestore } from 'firebase-admin/firestore'
import { getDomainConfig, saveDomainTopicCount, lockDomainTopicCount, unlockDomainTopicCount, raiseDomainTopicCount, validateTopicCount } from '../domainConfig'

function makeFirestore() {
  const docs = new Map<string, Record<string, unknown>>()

  function docRef(id: string) {
    return {
      get: async () => ({ exists: docs.has(id), data: () => docs.get(id) }),
      set: async (data: Record<string, unknown>) => { docs.set(id, data) },
    }
  }

  const collection = { doc: (id: string) => docRef(id) }
  const firestore = { collection: () => collection }
  return { firestore: firestore as unknown as Firestore, docs }
}

describe('validateTopicCount', () => {
  it('accepts an integer between 1 and 50', () => {
    expect(validateTopicCount(1)).toBeNull()
    expect(validateTopicCount(20)).toBeNull()
    expect(validateTopicCount(50)).toBeNull()
  })

  it('rejects zero, negative, non-integer, and above-50 values', () => {
    expect(validateTopicCount(0)).not.toBeNull()
    expect(validateTopicCount(-5)).not.toBeNull()
    expect(validateTopicCount(3.5)).not.toBeNull()
    expect(validateTopicCount(51)).not.toBeNull()
    expect(validateTopicCount('not-a-number')).not.toBeNull()
  })
})

describe('getDomainConfig', () => {
  it('returns null when no config has been saved for a domain', async () => {
    const { firestore } = makeFirestore()
    expect(await getDomainConfig(firestore, 'medical')).toBeNull()
  })
})

describe('saveDomainTopicCount', () => {
  it('persists an unlocked config', async () => {
    const { firestore } = makeFirestore()
    const config = await saveDomainTopicCount(firestore, 'medical', 20)
    expect(config).toEqual({ domainId: 'medical', topicCount: 20, locked: false, lockedAt: null, updatedAt: config.updatedAt })
    expect(await getDomainConfig(firestore, 'medical')).toEqual(config)
  })

  it('rejects an invalid topicCount without persisting', async () => {
    const { firestore } = makeFirestore()
    await expect(saveDomainTopicCount(firestore, 'medical', 0)).rejects.toThrow(/between 1 and/)
    expect(await getDomainConfig(firestore, 'medical')).toBeNull()
  })

  it('refuses to change a locked domain\'s count', async () => {
    const { firestore } = makeFirestore()
    await lockDomainTopicCount(firestore, 'medical', 20)
    await expect(saveDomainTopicCount(firestore, 'medical', 25)).rejects.toThrow(/locked/i)
  })

  it('allows re-saving repeatedly while unlocked', async () => {
    const { firestore } = makeFirestore()
    await saveDomainTopicCount(firestore, 'medical', 20)
    const second = await saveDomainTopicCount(firestore, 'medical', 15)
    expect(second.topicCount).toBe(15)
  })
})

describe('lockDomainTopicCount', () => {
  it('locks a previously-saved count and sets lockedAt', async () => {
    const { firestore } = makeFirestore()
    await saveDomainTopicCount(firestore, 'medical', 20)
    const locked = await lockDomainTopicCount(firestore, 'medical')
    expect(locked.locked).toBe(true)
    expect(locked.topicCount).toBe(20)
    expect(locked.lockedAt).not.toBeNull()
  })

  it('can save-and-lock in one call by passing an explicit topicCount', async () => {
    const { firestore } = makeFirestore()
    const locked = await lockDomainTopicCount(firestore, 'medical', 30)
    expect(locked.locked).toBe(true)
    expect(locked.topicCount).toBe(30)
  })

  it('throws when no count exists and none is provided', async () => {
    const { firestore } = makeFirestore()
    await expect(lockDomainTopicCount(firestore, 'medical')).rejects.toThrow(/set a topic count/i)
  })

  it('rejects an invalid explicit topicCount', async () => {
    const { firestore } = makeFirestore()
    await expect(lockDomainTopicCount(firestore, 'medical', 0)).rejects.toThrow(/between 1 and/)
  })

  it('is idempotent — locking an already-locked domain preserves the original lockedAt', async () => {
    const { firestore } = makeFirestore()
    const first = await lockDomainTopicCount(firestore, 'medical', 20)
    const second = await lockDomainTopicCount(firestore, 'medical', 20)
    expect(second.lockedAt).toBe(first.lockedAt)
  })
})

describe('unlockDomainTopicCount', () => {
  it('unlocks when no topics exist yet', async () => {
    const { firestore } = makeFirestore()
    await lockDomainTopicCount(firestore, 'medical', 20)
    const unlocked = await unlockDomainTopicCount(firestore, 'medical', 0)
    expect(unlocked.locked).toBe(false)
    expect(unlocked.lockedAt).toBeNull()
    expect(unlocked.topicCount).toBe(20)
  })

  it('refuses to unlock once topics already exist for the domain', async () => {
    const { firestore } = makeFirestore()
    await lockDomainTopicCount(firestore, 'medical', 20)
    await expect(unlockDomainTopicCount(firestore, 'medical', 5)).rejects.toThrow(/already has topics/i)
  })

  it('throws when there is no configuration to unlock', async () => {
    const { firestore } = makeFirestore()
    await expect(unlockDomainTopicCount(firestore, 'medical', 0)).rejects.toThrow(/no topic-count configuration/i)
  })
})

describe('raiseDomainTopicCount', () => {
  it('raises an already-locked count while staying locked', async () => {
    const { firestore } = makeFirestore()
    const original = await lockDomainTopicCount(firestore, 'medical', 20)
    const raised = await raiseDomainTopicCount(firestore, 'medical', 30)
    expect(raised.topicCount).toBe(30)
    expect(raised.locked).toBe(true)
    expect(raised.lockedAt).toBe(original.lockedAt)
  })

  it('refuses to raise an unlocked domain', async () => {
    const { firestore } = makeFirestore()
    await saveDomainTopicCount(firestore, 'medical', 20)
    await expect(raiseDomainTopicCount(firestore, 'medical', 30)).rejects.toThrow(/lock a topic count/i)
  })

  it('refuses a new count that is not strictly greater than the current one', async () => {
    const { firestore } = makeFirestore()
    await lockDomainTopicCount(firestore, 'medical', 20)
    await expect(raiseDomainTopicCount(firestore, 'medical', 20)).rejects.toThrow(/must be greater than/i)
    await expect(raiseDomainTopicCount(firestore, 'medical', 10)).rejects.toThrow(/must be greater than/i)
  })

  it('rejects an out-of-range new count', async () => {
    const { firestore } = makeFirestore()
    await lockDomainTopicCount(firestore, 'medical', 20)
    await expect(raiseDomainTopicCount(firestore, 'medical', 51)).rejects.toThrow(/between 1 and/)
  })

  it('throws when there is no configuration at all', async () => {
    const { firestore } = makeFirestore()
    await expect(raiseDomainTopicCount(firestore, 'medical', 30)).rejects.toThrow(/lock a topic count/i)
  })
})

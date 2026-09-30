import type { Firestore } from 'firebase-admin/firestore'
import type { Domain } from '@/lib/style/types'
import { MAX_TOPICS_PER_DOMAIN, type DomainOutlineConfig } from './types'

const COLLECTION = 'a2hDomainConfigs'

export async function getDomainConfig(firestore: Firestore, domainId: Domain): Promise<DomainOutlineConfig | null> {
  const doc = await firestore.collection(COLLECTION).doc(domainId).get()
  return doc.exists ? (doc.data() as DomainOutlineConfig) : null
}

export function validateTopicCount(topicCount: unknown): string | null {
  const n = Number(topicCount)
  if (!Number.isInteger(n) || n < 1 || n > MAX_TOPICS_PER_DOMAIN) {
    return `topicCount must be an integer between 1 and ${MAX_TOPICS_PER_DOMAIN}`
  }
  return null
}

// Persists a domain's topic-count while it's still unlocked — freely
// re-savable until locked, since nothing downstream depends on it yet.
export async function saveDomainTopicCount(firestore: Firestore, domainId: Domain, topicCount: number): Promise<DomainOutlineConfig> {
  const error = validateTopicCount(topicCount)
  if (error) throw new Error(error)

  const existing = await getDomainConfig(firestore, domainId)
  if (existing?.locked) {
    throw new Error('Topic count is locked for this domain — unlock it first.')
  }

  const config: DomainOutlineConfig = {
    domainId,
    topicCount,
    locked: false,
    lockedAt: null,
    updatedAt: new Date().toISOString(),
  }
  await firestore.collection(COLLECTION).doc(domainId).set(config)
  return config
}

// Locks the domain's topic count, which gates bulk outline generation
// (generateOutline refuses to run against an unlocked domain) — the roster
// size must be settled before anything is generated against topic slots.
// Optionally saves a new topicCount in the same call, so the UI's "Lock"
// action can commit whatever's in the input without a separate save step.
export async function lockDomainTopicCount(
  firestore: Firestore,
  domainId: Domain,
  topicCount?: number,
): Promise<DomainOutlineConfig> {
  const existing = await getDomainConfig(firestore, domainId)
  const count = topicCount ?? existing?.topicCount
  if (count == null) throw new Error('Set a topic count before locking.')
  const error = validateTopicCount(count)
  if (error) throw new Error(error)

  const config: DomainOutlineConfig = {
    domainId,
    topicCount: count,
    locked: true,
    lockedAt: existing?.locked ? existing.lockedAt : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  await firestore.collection(COLLECTION).doc(domainId).set(config)
  return config
}

// Only reversible before any topics exist for the domain — once outline
// generation (or manual entry) has produced topics against a locked count,
// changing that count would leave existing topics referencing slot numbers
// a new count might not include.
export async function unlockDomainTopicCount(
  firestore: Firestore,
  domainId: Domain,
  existingTopicCount: number,
): Promise<DomainOutlineConfig> {
  if (existingTopicCount > 0) {
    throw new Error('Cannot unlock a domain that already has topics — delete them first.')
  }
  const existing = await getDomainConfig(firestore, domainId)
  if (!existing) throw new Error('No topic-count configuration to unlock.')

  const config: DomainOutlineConfig = { ...existing, locked: false, lockedAt: null, updatedAt: new Date().toISOString() }
  await firestore.collection(COLLECTION).doc(domainId).set(config)
  return config
}

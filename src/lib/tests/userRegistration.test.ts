import { describe, it, expect } from 'vitest'
import type { Firestore } from 'firebase-admin/firestore'
import { registerUser } from '../userRegistration'

// Same minimal in-memory Firestore fake shape as refreshTokenRotation.test.ts
// — supports exactly what registerUser uses (doc-ref get/set inside a
// transaction). As there, real concurrent-request isolation isn't
// reproducible against a plain map; what these tests verify is that a
// SECOND registration attempt for an email a first attempt already claimed
// is correctly rejected rather than silently creating a second account.

interface DocRef { __isDocRef: true; id: string }

function makeFirestore() {
  const docStore = new Map<string, Record<string, unknown>>()

  const collectionApi = {
    doc: (id: string): DocRef => ({ __isDocRef: true, id }),
  }

  const firestore = {
    collection: () => collectionApi,
    runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        get: async (ref: DocRef) => {
          const data = docStore.get(ref.id)
          return { exists: !!data, data: () => data }
        },
        set: (ref: DocRef, data: Record<string, unknown>) => {
          docStore.set(ref.id, data)
        },
      }
      return fn(tx)
    },
  }

  return { firestore: firestore as unknown as Firestore, docStore }
}

describe('registerUser', () => {
  it('creates a new user for a fresh email', async () => {
    const { firestore, docStore } = makeFirestore()
    const result = await registerUser(firestore, 'new@example.com', 'password123')
    expect(result.ok).toBe(true)
    expect(result.userId).toBeTruthy()

    const userDoc = docStore.get(result.userId!)
    expect(userDoc).toMatchObject({ email: 'new@example.com', tier: 'free' })
    // Password is hashed, not stored raw.
    expect(userDoc?.passwordHash).not.toBe('password123')
  })

  it('rejects a second registration for an email the first attempt already claimed', async () => {
    // This is the actual race this fix closes: the old code's separate
    // existence-query-then-insert let two concurrent attempts both observe
    // "no existing user" and both insert. Here the first attempt's write is
    // fully applied (no real concurrency in this fake), so the second must
    // see the claimed email and be rejected — never silently create a
    // second account sharing the same address.
    const { firestore, docStore } = makeFirestore()
    const first = await registerUser(firestore, 'dup@example.com', 'password123')
    expect(first.ok).toBe(true)

    const second = await registerUser(firestore, 'dup@example.com', 'different-password')
    expect(second.ok).toBe(false)

    // Only one user document exists for this email.
    const usersWithEmail = [...docStore.values()].filter(d => d.email === 'dup@example.com')
    expect(usersWithEmail).toHaveLength(1)
  })

  it('allows different emails to register independently', async () => {
    const { firestore } = makeFirestore()
    const a = await registerUser(firestore, 'a@example.com', 'password123')
    const b = await registerUser(firestore, 'b@example.com', 'password123')
    expect(a.ok).toBe(true)
    expect(b.ok).toBe(true)
    expect(a.userId).not.toBe(b.userId)
  })
})

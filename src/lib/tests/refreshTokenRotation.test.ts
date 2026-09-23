import { describe, it, expect, beforeEach } from 'vitest'
import type { Firestore } from 'firebase-admin/firestore'
import { rotateRefreshToken } from '../refreshTokenRotation'

// A minimal in-memory Firestore fake supporting exactly what
// rotateRefreshToken uses: doc-ref get/update/set and a two-field .where()
// query, all inside runTransaction. Real Firestore's optimistic-concurrency
// retry (what actually prevents the race in production) isn't reproducible
// against a plain in-memory map — what IS reproducible, and what these
// tests check, is that a SECOND rotation attempt against a token already
// consumed by a first one is correctly detected and reacted to (the family
// gets revoked) rather than silently succeeding a second time. That's the
// actual bug: the old code let two concurrent reads both pass the
// not-yet-revoked check before either write landed.

interface DocRef { __isDocRef: true; id: string }
interface Query { __isQuery: true; matches: (id: string, data: Record<string, unknown>) => boolean }

function makeFirestore(initial: Record<string, Record<string, unknown>> = {}) {
  const docStore = new Map(Object.entries(initial))

  function makeQuery(filters: [string, unknown][]): Query {
    return {
      __isQuery: true,
      matches: (_id, data) => filters.every(([field, value]) => data[field] === value),
    }
  }

  const collectionApi = {
    doc: (id: string): DocRef => ({ __isDocRef: true, id }),
    where(field: string, _op: string, value: unknown) {
      const query = makeQuery([[field, value]])
      return {
        ...query,
        where: (field2: string, _op2: string, value2: unknown) => makeQuery([[field, value], [field2, value2]]),
      }
    },
  }

  const firestore = {
    collection: () => collectionApi,
    runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        get: async (target: DocRef | Query) => {
          if ('__isDocRef' in target) {
            const data = docStore.get(target.id)
            return { exists: !!data, data: () => data }
          }
          const docs = [...docStore.entries()]
            .filter(([id, data]) => target.matches(id, data))
            .map(([id, data]) => ({ id, data: () => data, ref: { __isDocRef: true, id } as DocRef }))
          return { docs }
        },
        update: (ref: DocRef, patch: Record<string, unknown>) => {
          docStore.set(ref.id, { ...(docStore.get(ref.id) ?? {}), ...patch })
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

function tokenDoc(overrides: Record<string, unknown> = {}) {
  return {
    userId: 'user-1',
    familyId: 'family-1',
    expiresAt: { toDate: () => new Date(Date.now() + 60_000) },
    createdAt: new Date(),
    revokedAt: null,
    ...overrides,
  }
}

describe('rotateRefreshToken', () => {
  it('returns ok:false for a token that does not exist', async () => {
    const { firestore } = makeFirestore()
    const result = await rotateRefreshToken(firestore, 'missing-hash')
    expect(result.ok).toBe(false)
  })

  it('rotates a valid, unused token: revokes the old one and mints a successor', async () => {
    const { firestore, docStore } = makeFirestore({ 'hash-1': tokenDoc() })
    const result = await rotateRefreshToken(firestore, 'hash-1')

    expect(result.ok).toBe(true)
    expect(result.userId).toBe('user-1')
    expect(result.rawRefreshToken).toBeTruthy()

    expect(docStore.get('hash-1')).toMatchObject({ revokedAt: expect.any(Date) })
    // A successor token was created somewhere in the store, unrevoked.
    const successor = [...docStore.values()].find(d => d !== docStore.get('hash-1') && d.revokedAt === null)
    expect(successor).toMatchObject({ userId: 'user-1', familyId: 'family-1', revokedAt: null })
  })

  it('rejects an expired token without revoking it further', async () => {
    const { firestore } = makeFirestore({
      'hash-1': tokenDoc({ expiresAt: { toDate: () => new Date(Date.now() - 1000) } }),
    })
    const result = await rotateRefreshToken(firestore, 'hash-1')
    expect(result.ok).toBe(false)
  })

  it('detects reuse of an already-consumed token and revokes the entire family — the theft-detection path', async () => {
    const { firestore, docStore } = makeFirestore({
      'hash-1': tokenDoc({ revokedAt: new Date() }),
      'hash-2': tokenDoc({ familyId: 'family-1', revokedAt: null }), // a sibling still active
    })
    const result = await rotateRefreshToken(firestore, 'hash-1')
    expect(result.ok).toBe(false)
    // The sibling, still-active token in the same family must now be revoked too.
    expect(docStore.get('hash-2')).toMatchObject({ revokedAt: expect.any(Date) })
  })

  it('a second rotation attempt against a token the first attempt already consumed is treated as reuse, not a second success', async () => {
    // This is the actual regression this fix targets: the old code's
    // read-check-then-separately-write sequence let two callers both pass
    // the not-yet-revoked check. Here, the first call's write is fully
    // applied (this fake has no concurrency to race against), so the second
    // call must see the now-revoked token and fail — never silently succeed.
    const { firestore } = makeFirestore({ 'hash-1': tokenDoc() })
    const first = await rotateRefreshToken(firestore, 'hash-1')
    expect(first.ok).toBe(true)

    const second = await rotateRefreshToken(firestore, 'hash-1')
    expect(second.ok).toBe(false)
  })

  it('does not touch tokens from a different family when revoking on reuse', async () => {
    const { firestore, docStore } = makeFirestore({
      'hash-1': tokenDoc({ familyId: 'family-1', revokedAt: new Date() }),
      'other-family-token': tokenDoc({ familyId: 'family-2', revokedAt: null }),
    })
    await rotateRefreshToken(firestore, 'hash-1')
    expect(docStore.get('other-family-token')).toMatchObject({ revokedAt: null })
  })
})

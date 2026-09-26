import { describe, it, expect } from 'vitest'
import type { Firestore } from 'firebase-admin/firestore'
import { setAccountTierByEmail } from '../setAccountTier'

interface FakeUserDoc { id: string; data: Record<string, unknown> }

// A minimal in-memory Firestore fake supporting exactly the chained query
// shape setAccountTierByEmail uses (collection().where().where().limit().get()),
// plus doc.ref.update() — the same "just enough surface" approach
// userRegistration.test.ts and usageLimits.test.ts already use for their
// own Firestore fakes.
function makeFirestore(seed: FakeUserDoc[]) {
  const docs = new Map(seed.map(d => [d.id, { ...d.data }]))

  function makeQuery(predicate: (d: FakeUserDoc) => boolean): unknown {
    return {
      where(field: string, _op: string, value: unknown) {
        return makeQuery(d => predicate(d) && d.data[field] === value)
      },
      limit(_n: number) {
        return this
      },
      async get() {
        const matched = [...docs.entries()]
          .map(([id, data]) => ({ id, data }))
          .filter(predicate)
        return {
          empty: matched.length === 0,
          docs: matched.map(d => ({
            id: d.id,
            data: () => d.data,
            ref: {
              update: async (patch: Record<string, unknown>) => {
                docs.set(d.id, { ...d.data, ...patch })
              },
            },
          })),
        }
      },
    }
  }

  const firestore = {
    collection: () => makeQuery(() => true),
  }

  return { firestore: firestore as unknown as Firestore, docs }
}

describe('setAccountTierByEmail', () => {
  it('resolves jdzelazny@gmail.com to Gold: grants the gold tier to the matching account', async () => {
    const { firestore, docs } = makeFirestore([
      { id: 'user-jd', data: { email: 'jdzelazny@gmail.com', tier: 'free', deletedAt: null } },
    ])

    const result = await setAccountTierByEmail(firestore, 'jdzelazny@gmail.com', 'gold')

    expect(result.ok).toBe(true)
    expect(result.userId).toBe('user-jd')
    expect(result.previousTier).toBe('free')
    expect(docs.get('user-jd')?.tier).toBe('gold')
  })

  it('is case-insensitive and trims whitespace on the email lookup', async () => {
    const { firestore, docs } = makeFirestore([
      { id: 'user-jd', data: { email: 'jdzelazny@gmail.com', tier: 'free', deletedAt: null } },
    ])

    const result = await setAccountTierByEmail(firestore, '  JDZelazny@Gmail.com  ', 'gold')
    expect(result.ok).toBe(true)
    expect(docs.get('user-jd')?.tier).toBe('gold')
  })

  it('preserves every other stored field on the account (identity, credentials, history)', async () => {
    const { firestore, docs } = makeFirestore([
      {
        id: 'user-jd',
        data: {
          email: 'jdzelazny@gmail.com',
          passwordHash: 'a-real-bcrypt-hash',
          region: 'us-east1',
          tier: 'free',
          deletedAt: null,
          createdAt: 'original-creation-timestamp',
        },
      },
    ])

    await setAccountTierByEmail(firestore, 'jdzelazny@gmail.com', 'gold')

    const after = docs.get('user-jd')!
    expect(after.email).toBe('jdzelazny@gmail.com')
    expect(after.passwordHash).toBe('a-real-bcrypt-hash')
    expect(after.region).toBe('us-east1')
    expect(after.createdAt).toBe('original-creation-timestamp')
    expect(after.tier).toBe('gold')
  })

  it('rejects an unknown tier without touching the account', async () => {
    const { firestore, docs } = makeFirestore([
      { id: 'user-jd', data: { email: 'jdzelazny@gmail.com', tier: 'free', deletedAt: null } },
    ])

    const result = await setAccountTierByEmail(firestore, 'jdzelazny@gmail.com', 'platinum')
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/unknown tier/i)
    expect(docs.get('user-jd')?.tier).toBe('free')
  })

  it('reports failure for an email with no matching account', async () => {
    const { firestore } = makeFirestore([])
    const result = await setAccountTierByEmail(firestore, 'nobody@example.com', 'gold')
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/no account found/i)
  })

  it('does not grant a tier to a soft-deleted account', async () => {
    const { firestore, docs } = makeFirestore([
      { id: 'user-deleted', data: { email: 'gone@example.com', tier: 'free', deletedAt: new Date() } },
    ])

    const result = await setAccountTierByEmail(firestore, 'gone@example.com', 'gold')
    expect(result.ok).toBe(false)
    expect(docs.get('user-deleted')?.tier).toBe('free')
  })

  it('is idempotent — granting gold to an already-gold account is a no-op success', async () => {
    const { firestore, docs } = makeFirestore([
      { id: 'user-jd', data: { email: 'jdzelazny@gmail.com', tier: 'gold', deletedAt: null } },
    ])

    const result = await setAccountTierByEmail(firestore, 'jdzelazny@gmail.com', 'gold')
    expect(result.ok).toBe(true)
    expect(result.previousTier).toBe('gold')
    expect(docs.get('user-jd')?.tier).toBe('gold')
  })
})

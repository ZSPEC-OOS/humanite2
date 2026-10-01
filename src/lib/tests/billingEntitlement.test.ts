import { describe, it, expect, afterEach } from 'vitest'
import type { Firestore } from 'firebase-admin/firestore'
import type Stripe from 'stripe'
import {
  tierForPriceId,
  resolveEntitlementFromCheckoutSession,
  resolveEntitlementFromSubscription,
  applySubscriptionEntitlement,
} from '../billingEntitlement'

// "Pricing Cleanup" patch — the webhook entitlement path is the critical
// fix in this patch (a completed Stripe purchase must actually change
// users/{userId}.tier, which it previously never did at all). This file is
// the direct regression test for that: price-id resolution, event-shape
// resolution, and the transactional idempotent/Gold-protected write.

function makeFirestore() {
  const collections = new Map<string, Map<string, Record<string, unknown>>>()

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
    }
  }

  function collection(name: string) {
    return { doc: (id: string) => docRef(name, id) }
  }

  // docRef already closes over the right collection's map, so the
  // transaction can delegate straight to ref.get/set/update — this fake
  // doesn't need to simulate Firestore's real read-then-write atomicity
  // ordering beyond what these tests exercise (no concurrent callers).
  async function runTransaction<T>(
    fn: (tx: {
      get: (ref: ReturnType<typeof docRef>) => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>
      set: (ref: ReturnType<typeof docRef>, data: Record<string, unknown>) => Promise<void>
      update: (ref: ReturnType<typeof docRef>, patch: Record<string, unknown>) => Promise<void>
    }) => Promise<T>,
  ): Promise<T> {
    const tx = {
      get: async (ref: ReturnType<typeof docRef>) => ref.get(),
      set: async (ref: ReturnType<typeof docRef>, data: Record<string, unknown>) => { await ref.set(data) },
      update: async (ref: ReturnType<typeof docRef>, patch: Record<string, unknown>) => { await ref.update(patch) },
    }
    return fn(tx)
  }

  return { firestore: { collection, runTransaction } as unknown as Firestore, collections }
}

const ORIGINAL_ENV = { ...process.env }
function resetEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key]
  }
  Object.assign(process.env, ORIGINAL_ENV)
}
afterEach(resetEnv)

describe('tierForPriceId', () => {
  it('resolves each paid tier from its own env-configured Price ID', () => {
    process.env.STRIPE_PRICE_ID_STARTER = 'price_starter'
    process.env.STRIPE_PRICE_ID_PRO = 'price_pro'
    process.env.STRIPE_PRICE_ID_MAX = 'price_max'
    expect(tierForPriceId('price_starter')).toBe('starter')
    expect(tierForPriceId('price_pro')).toBe('pro')
    expect(tierForPriceId('price_max')).toBe('enterprise')
  })

  it('returns null for an unrecognized price id, a null id, and when no env vars are configured', () => {
    expect(tierForPriceId('price_unknown')).toBeNull()
    expect(tierForPriceId(null)).toBeNull()
    expect(tierForPriceId(undefined)).toBeNull()
  })

  it('re-reads env on every call — a rotated Price ID takes effect without caching', () => {
    process.env.STRIPE_PRICE_ID_STARTER = 'price_v1'
    expect(tierForPriceId('price_v1')).toBe('starter')
    process.env.STRIPE_PRICE_ID_STARTER = 'price_v2'
    expect(tierForPriceId('price_v1')).toBeNull()
    expect(tierForPriceId('price_v2')).toBe('starter')
  })
})

describe('resolveEntitlementFromCheckoutSession', () => {
  it('reads userId/plan from session metadata (the primary path)', () => {
    const session = { metadata: { userId: 'user-1', plan: 'starter' }, client_reference_id: null } as unknown as Stripe.Checkout.Session
    expect(resolveEntitlementFromCheckoutSession(session)).toEqual({ userId: 'user-1', tier: 'starter' })
  })

  it('falls back to client_reference_id when metadata.userId is absent', () => {
    const session = { metadata: {}, client_reference_id: 'user-2' } as unknown as Stripe.Checkout.Session
    expect(resolveEntitlementFromCheckoutSession(session).userId).toBe('user-2')
  })

  it('returns nulls when neither metadata nor client_reference_id identify a user', () => {
    const session = { metadata: null, client_reference_id: null } as unknown as Stripe.Checkout.Session
    expect(resolveEntitlementFromCheckoutSession(session)).toEqual({ userId: null, tier: null })
  })
})

describe('resolveEntitlementFromSubscription', () => {
  it('derives tier from the CURRENT price, even when metadata.plan disagrees (a portal-driven plan change)', () => {
    process.env.STRIPE_PRICE_ID_PRO = 'price_pro'
    const subscription = {
      metadata: { userId: 'user-1', plan: 'starter' }, // stale — created at checkout for Starter
      items: { data: [{ price: { id: 'price_pro' } }] }, // but since upgraded to Pro via the customer portal
    } as unknown as Stripe.Subscription
    expect(resolveEntitlementFromSubscription(subscription)).toEqual({ userId: 'user-1', tier: 'pro' })
  })

  it('falls back to metadata.plan when the current price matches no known tier', () => {
    const subscription = {
      metadata: { userId: 'user-1', plan: 'starter' },
      items: { data: [{ price: { id: 'price_unrecognized' } }] },
    } as unknown as Stripe.Subscription
    expect(resolveEntitlementFromSubscription(subscription)).toEqual({ userId: 'user-1', tier: 'starter' })
  })

  it('returns a null userId when the subscription carries no metadata.userId', () => {
    const subscription = { metadata: {}, items: { data: [] } } as unknown as Stripe.Subscription
    expect(resolveEntitlementFromSubscription(subscription).userId).toBeNull()
  })
})

describe('applySubscriptionEntitlement', () => {
  it('upgrades a free user to starter', async () => {
    const { firestore } = makeFirestore()
    await firestore.collection('users').doc('user-1').set({ tier: 'free' })
    const result = await applySubscriptionEntitlement(firestore, { eventId: 'evt_1', userId: 'user-1', tier: 'starter' })
    expect(result).toEqual({ applied: true, outcome: 'applied' })
    expect((await firestore.collection('users').doc('user-1').get()).data()?.tier).toBe('starter')
  })

  it('upgrades a starter user to pro, and later to enterprise (Max)', async () => {
    const { firestore } = makeFirestore()
    await firestore.collection('users').doc('user-1').set({ tier: 'starter' })
    await applySubscriptionEntitlement(firestore, { eventId: 'evt_1', userId: 'user-1', tier: 'pro' })
    expect((await firestore.collection('users').doc('user-1').get()).data()?.tier).toBe('pro')
    await applySubscriptionEntitlement(firestore, { eventId: 'evt_2', userId: 'user-1', tier: 'enterprise' })
    expect((await firestore.collection('users').doc('user-1').get()).data()?.tier).toBe('enterprise')
  })

  it('downgrades to free on subscription cancellation', async () => {
    const { firestore } = makeFirestore()
    await firestore.collection('users').doc('user-1').set({ tier: 'pro' })
    await applySubscriptionEntitlement(firestore, { eventId: 'evt_1', userId: 'user-1', tier: 'free' })
    expect((await firestore.collection('users').doc('user-1').get()).data()?.tier).toBe('free')
  })

  it('is idempotent — replaying the same Stripe event id never applies the transition twice', async () => {
    const { firestore } = makeFirestore()
    await firestore.collection('users').doc('user-1').set({ tier: 'free' })
    const first = await applySubscriptionEntitlement(firestore, { eventId: 'evt_dup', userId: 'user-1', tier: 'starter' })
    expect(first.applied).toBe(true)

    // Manually move the user to pro (simulating a later, independent event)
    // to prove the replayed evt_dup does NOT re-apply 'starter' over it.
    await firestore.collection('users').doc('user-1').update({ tier: 'pro' })

    const replay = await applySubscriptionEntitlement(firestore, { eventId: 'evt_dup', userId: 'user-1', tier: 'starter' })
    expect(replay).toEqual({ applied: false, outcome: 'duplicate_event' })
    expect((await firestore.collection('users').doc('user-1').get()).data()?.tier).toBe('pro')
  })

  it('never downgrades a Gold account via an ordinary subscription event', async () => {
    const { firestore } = makeFirestore()
    await firestore.collection('users').doc('gold-user').set({ tier: 'gold' })
    const result = await applySubscriptionEntitlement(firestore, { eventId: 'evt_1', userId: 'gold-user', tier: 'free' })
    expect(result).toEqual({ applied: false, outcome: 'gold_protected' })
    expect((await firestore.collection('users').doc('gold-user').get()).data()?.tier).toBe('gold')
  })

  it('reports user_not_found without throwing when the userId does not resolve to a real account', async () => {
    const { firestore } = makeFirestore()
    const result = await applySubscriptionEntitlement(firestore, { eventId: 'evt_1', userId: 'nonexistent', tier: 'starter' })
    expect(result).toEqual({ applied: false, outcome: 'user_not_found' })
  })

  it('a distinct event id for the same logical transition is NOT treated as a duplicate (only exact event id replay is)', async () => {
    const { firestore } = makeFirestore()
    await firestore.collection('users').doc('user-1').set({ tier: 'free' })
    await applySubscriptionEntitlement(firestore, { eventId: 'evt_a', userId: 'user-1', tier: 'starter' })
    const second = await applySubscriptionEntitlement(firestore, { eventId: 'evt_b', userId: 'user-1', tier: 'pro' })
    expect(second.applied).toBe(true)
    expect((await firestore.collection('users').doc('user-1').get()).data()?.tier).toBe('pro')
  })
})

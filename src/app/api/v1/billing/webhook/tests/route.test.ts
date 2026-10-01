import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import type { Firestore } from 'firebase-admin/firestore'

const { constructEvent, firestoreRef } = vi.hoisted(() => ({
  constructEvent: vi.fn(),
  firestoreRef: { current: null as unknown as { firestore: Firestore } },
}))

vi.mock('@/lib/stripe', () => ({
  getStripe: () => ({ webhooks: { constructEvent } }),
}))

vi.mock('@/lib/firestore', () => ({
  db: () => firestoreRef.current.firestore,
  tryPersist: async (op: () => Promise<unknown>) => {
    try { await op(); return true } catch { return false }
  },
}))

const { POST } = await import('../route')

// Same per-collection-map fake used throughout this codebase's other
// transactional tests (e.g. src/lib/a2h/tests/execution.test.ts).
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
    }
  }

  function collection(name: string) {
    return {
      doc: (id?: string) => docRef(name, id ?? `auto-${++counter}`),
      add: async (data: Record<string, unknown>) => { await docRef(name, `auto-${++counter}`).set(data) },
    }
  }

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

  return { firestore: { collection, runTransaction } as unknown as Firestore, collections, docsFor }
}

function req(body: string): NextRequest {
  return new NextRequest('http://localhost/api/v1/billing/webhook', {
    method: 'POST',
    body,
    headers: { 'stripe-signature': 'test-signature' },
  })
}

const ORIGINAL_ENV = { ...process.env }
function resetEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key]
  }
  Object.assign(process.env, ORIGINAL_ENV)
}

beforeEach(() => {
  resetEnv()
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test'
  process.env.STRIPE_PRICE_ID_STARTER = 'price_starter'
  process.env.STRIPE_PRICE_ID_PRO = 'price_pro'
  process.env.STRIPE_PRICE_ID_MAX = 'price_max'
  constructEvent.mockReset()
  firestoreRef.current = makeFirestore()
})
afterEach(resetEnv)

// This is the critical regression test the "Pricing Cleanup" patch exists
// to add: a completed Stripe purchase must actually change
// users/{userId}.tier. Before this patch, the webhook only logged the raw
// event and never touched the user record at all — a real billing bug this
// test would have caught immediately.
describe('POST /api/v1/billing/webhook — entitlement application', () => {
  it('checkout.session.completed for Starter sets the user tier to starter', async () => {
    const { firestore } = firestoreRef.current
    await firestore.collection('users').doc('user-1').set({ tier: 'free' })

    constructEvent.mockReturnValue({
      id: 'evt_1',
      type: 'checkout.session.completed',
      data: { object: { metadata: { userId: 'user-1', plan: 'starter' }, client_reference_id: 'user-1' } },
    })

    const res = await POST(req('{}'))
    expect(res.status).toBe(200)
    expect((await firestore.collection('users').doc('user-1').get()).data()?.tier).toBe('starter')
  })

  it('customer.subscription.updated to the Pro price upgrades an existing Starter user to pro', async () => {
    const { firestore } = firestoreRef.current
    await firestore.collection('users').doc('user-1').set({ tier: 'starter' })

    constructEvent.mockReturnValue({
      id: 'evt_2',
      type: 'customer.subscription.updated',
      data: { object: { status: 'active', metadata: { userId: 'user-1', plan: 'starter' }, items: { data: [{ price: { id: 'price_pro' } }] } } },
    })

    await POST(req('{}'))
    expect((await firestore.collection('users').doc('user-1').get()).data()?.tier).toBe('pro')
  })

  it('customer.subscription.updated to the Max price sets tier to enterprise', async () => {
    const { firestore } = firestoreRef.current
    await firestore.collection('users').doc('user-1').set({ tier: 'pro' })

    constructEvent.mockReturnValue({
      id: 'evt_3',
      type: 'customer.subscription.updated',
      data: { object: { status: 'active', metadata: { userId: 'user-1' }, items: { data: [{ price: { id: 'price_max' } }] } } },
    })

    await POST(req('{}'))
    expect((await firestore.collection('users').doc('user-1').get()).data()?.tier).toBe('enterprise')
  })

  it('customer.subscription.deleted downgrades the user to free', async () => {
    const { firestore } = firestoreRef.current
    await firestore.collection('users').doc('user-1').set({ tier: 'pro' })

    constructEvent.mockReturnValue({
      id: 'evt_4',
      type: 'customer.subscription.deleted',
      data: { object: { metadata: { userId: 'user-1' }, items: { data: [{ price: { id: 'price_pro' } }] } } },
    })

    await POST(req('{}'))
    expect((await firestore.collection('users').doc('user-1').get()).data()?.tier).toBe('free')
  })

  it('customer.subscription.updated with status past_due downgrades to free immediately, without waiting for subscription.deleted', async () => {
    const { firestore } = firestoreRef.current
    await firestore.collection('users').doc('user-1').set({ tier: 'pro' })

    constructEvent.mockReturnValue({
      id: 'evt_pastdue',
      type: 'customer.subscription.updated',
      data: { object: { status: 'past_due', metadata: { userId: 'user-1', plan: 'pro' }, items: { data: [{ price: { id: 'price_pro' } }] } } },
    })

    await POST(req('{}'))
    expect((await firestore.collection('users').doc('user-1').get()).data()?.tier).toBe('free')
  })

  it('a Gold user is never downgraded by an ordinary subscription.deleted event', async () => {
    const { firestore } = firestoreRef.current
    await firestore.collection('users').doc('gold-user').set({ tier: 'gold' })

    constructEvent.mockReturnValue({
      id: 'evt_5',
      type: 'customer.subscription.deleted',
      data: { object: { metadata: { userId: 'gold-user' }, items: { data: [] } } },
    })

    await POST(req('{}'))
    expect((await firestore.collection('users').doc('gold-user').get()).data()?.tier).toBe('gold')
  })

  it('webhook replay (same Stripe event id delivered twice) is safe and never double-applies', async () => {
    const { firestore } = firestoreRef.current
    await firestore.collection('users').doc('user-1').set({ tier: 'free' })

    constructEvent.mockReturnValue({
      id: 'evt_replay',
      type: 'checkout.session.completed',
      data: { object: { metadata: { userId: 'user-1', plan: 'starter' } } },
    })

    await POST(req('{}'))
    expect((await firestore.collection('users').doc('user-1').get()).data()?.tier).toBe('starter')

    // A later, independent event moves the user to pro.
    await firestore.collection('users').doc('user-1').update({ tier: 'pro' })

    // Stripe redelivers the FIRST event (same id) — must be a safe no-op,
    // never reverting the user back to starter.
    await POST(req('{}'))
    expect((await firestore.collection('users').doc('user-1').get()).data()?.tier).toBe('pro')
  })

  it('rejects a request with an invalid signature without applying any entitlement', async () => {
    constructEvent.mockImplementation(() => { throw new Error('signature mismatch') })
    const res = await POST(req('{}'))
    expect(res.status).toBe(400)
  })

  it('returns 503 when STRIPE_WEBHOOK_SECRET is not configured', async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET
    const res = await POST(req('{}'))
    expect(res.status).toBe(503)
  })

  it('an event with no resolvable userId/tier is accepted (200) but applies nothing', async () => {
    constructEvent.mockReturnValue({
      id: 'evt_unattributed',
      type: 'checkout.session.completed',
      data: { object: { metadata: {}, client_reference_id: null } },
    })
    const res = await POST(req('{}'))
    expect(res.status).toBe(200)
  })

  it('an irrelevant event type is accepted and ignored', async () => {
    constructEvent.mockReturnValue({ id: 'evt_irrelevant', type: 'invoice.paid', data: { object: {} } })
    const res = await POST(req('{}'))
    expect(res.status).toBe(200)
  })

  it('still logs the raw event to billing_events regardless of entitlement outcome', async () => {
    const { firestore, docsFor } = firestoreRef.current as ReturnType<typeof makeFirestore>
    await firestore.collection('users').doc('user-1').set({ tier: 'free' })
    constructEvent.mockReturnValue({
      id: 'evt_logged',
      type: 'checkout.session.completed',
      data: { object: { metadata: { userId: 'user-1', plan: 'starter' } } },
    })
    await POST(req('{}'))
    expect(docsFor('billing_events').size).toBe(1)
  })
})

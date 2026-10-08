import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const { sessionsCreate, requireAuthMock } = vi.hoisted(() => ({
  sessionsCreate: vi.fn(),
  requireAuthMock: vi.fn(),
}))

vi.mock('@/lib/require-auth', () => ({
  requireAuth: requireAuthMock,
  isAuthFailure: (result: unknown) => result instanceof Response,
}))

vi.mock('@/lib/stripe', () => ({
  getStripe: () => ({ checkout: { sessions: { create: sessionsCreate } } }),
}))

const { POST } = await import('../route')

const ORIGINAL_ENV = { ...process.env }
function resetEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key]
  }
  Object.assign(process.env, ORIGINAL_ENV)
}

beforeEach(() => {
  resetEnv()
  sessionsCreate.mockReset()
  requireAuthMock.mockReset()
  requireAuthMock.mockResolvedValue({ claims: { sub: 'user-1', tier: 'free', region: 'us-east1', scopes: [], email_hash: 'hash' } })
  process.env.STRIPE_PRICE_ID_STARTER = 'price_starter'
  process.env.STRIPE_PRICE_ID_PRO = 'price_pro'
  process.env.STRIPE_PRICE_ID_MAX = 'price_max'
  process.env.STRIPE_SECRET_KEY = 'sk_test_whatever'
})
afterEach(resetEnv)

function req(plan: string | undefined): NextRequest {
  return new NextRequest('http://localhost/api/v1/billing/checkout', {
    method: 'POST',
    body: JSON.stringify({ plan }),
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('POST /api/v1/billing/checkout', () => {
  it('free never creates a checkout session — returns FREE_PLAN_NO_CHECKOUT', async () => {
    const res = await POST(req('free'))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('FREE_PLAN_NO_CHECKOUT')
    expect(sessionsCreate).not.toHaveBeenCalled()
  })

  it('creates a Starter checkout session with the Starter Price ID', async () => {
    sessionsCreate.mockResolvedValue({ url: 'https://stripe.test/session/starter' })
    const res = await POST(req('starter'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.url).toBe('https://stripe.test/session/starter')
    expect(sessionsCreate).toHaveBeenCalledWith(expect.objectContaining({
      line_items: [{ price: 'price_starter', quantity: 1 }],
    }))
  })

  it('creates a Pro checkout session with the Pro Price ID', async () => {
    sessionsCreate.mockResolvedValue({ url: 'https://stripe.test/session/pro' })
    await POST(req('pro'))
    expect(sessionsCreate).toHaveBeenCalledWith(expect.objectContaining({
      line_items: [{ price: 'price_pro', quantity: 1 }],
    }))
  })

  it('creates a Max checkout session with the Max Price ID under the internal "enterprise" id', async () => {
    sessionsCreate.mockResolvedValue({ url: 'https://stripe.test/session/max' })
    await POST(req('enterprise'))
    expect(sessionsCreate).toHaveBeenCalledWith(expect.objectContaining({
      line_items: [{ price: 'price_max', quantity: 1 }],
    }))
  })

  it('stamps userId + plan metadata on both the session and the subscription it creates, for webhook correlation', async () => {
    sessionsCreate.mockResolvedValue({ url: 'https://stripe.test/session/starter' })
    await POST(req('starter'))
    expect(sessionsCreate).toHaveBeenCalledWith(expect.objectContaining({
      client_reference_id: 'user-1',
      metadata: { userId: 'user-1', plan: 'starter' },
      subscription_data: { metadata: { userId: 'user-1', plan: 'starter' } },
    }))
  })

  it('rejects an invalid/unknown plan cleanly, without calling Stripe', async () => {
    const res = await POST(req('not-a-real-plan'))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('PLAN_NOT_AVAILABLE_FOR_CHECKOUT')
    expect(sessionsCreate).not.toHaveBeenCalled()
  })

  it('rejects a plan with no configured Price ID env var', async () => {
    delete process.env.STRIPE_PRICE_ID_STARTER
    const res = await POST(req('starter'))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('PLAN_NOT_AVAILABLE_FOR_CHECKOUT')
  })

  it('requires authentication', async () => {
    requireAuthMock.mockResolvedValue(new Response(null, { status: 401 }))
    const res = await POST(req('starter'))
    expect(res.status).toBe(401)
    expect(sessionsCreate).not.toHaveBeenCalled()
  })
})

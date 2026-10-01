import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { claims } = vi.hoisted(() => ({
  claims: {
    sub: 'user-1',
    tier: 'free',
    region: 'us-east1',
    scopes: [],
    email_hash: 'hash',
    a2h_admin: false,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
}))

vi.mock('@/lib/require-auth', () => ({
  requireAuth: vi.fn(async () => ({ claims })),
  isAuthFailure: (result: unknown) => result instanceof Response,
}))

const { getUsageSummary } = vi.hoisted(() => ({ getUsageSummary: vi.fn() }))
vi.mock('@/lib/usageLimits', () => ({ getUsageSummary }))

const { GET } = await import('../route')

function req(): NextRequest {
  return new NextRequest('http://localhost/api/v1/user/usage', { method: 'GET' })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/v1/user/usage', () => {
  it('returns the authenticated caller\'s own usage summary', async () => {
    getUsageSummary.mockResolvedValue({
      tier: 'free',
      planName: 'Free',
      unlimited: false,
      available: true,
      generation: { used: 120, limit: 1_200 },
      scan: { used: 40, limit: 1_200 },
    })

    const res = await GET(req())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.planName).toBe('Free')
    expect(body.generation).toEqual({ used: 120, limit: 1_200 })
    expect(getUsageSummary).toHaveBeenCalledWith('user-1', 'free', 'hash')
  })

  it('rejects an unauthenticated request without ever calling getUsageSummary', async () => {
    const { requireAuth } = await import('@/lib/require-auth')
    vi.mocked(requireAuth).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: 'AUTHENTICATION_REQUIRED' } }), { status: 401 }) as never,
    )
    const res = await GET(req())
    expect(res.status).toBe(401)
    expect(getUsageSummary).not.toHaveBeenCalled()
  })
})

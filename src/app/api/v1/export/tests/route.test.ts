import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/require-auth', () => ({
  requireAuth: vi.fn().mockResolvedValue({ claims: { sub: 'user-1', tier: 'free', region: 'us-east1', scopes: [], email_hash: 'hash' } }),
  isAuthFailure: (result: unknown) => result instanceof Response,
}))

vi.mock('@/lib/exportVerification', () => ({
  resolveVerification: vi.fn().mockResolvedValue(null),
}))

const { POST } = await import('../route')

function req(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/v1/export', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

// Deep-audit regression test: unlike /api/v1/humanize and /api/v1/scan
// (both of which reject text over their own max-length constants), this
// route previously had NO length ceiling — a direct API call with
// multi-megabyte text could force unbounded paragraph-splitting/DOCX
// generation per request.
describe('POST /api/v1/export — length validation', () => {
  it('rejects text over the 300,000 character ceiling', async () => {
    const res = await POST(req({ text: 'a'.repeat(300_001), format: 'text' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error.code).toBe('VALIDATION_MAX_LENGTH')
  })

  it('accepts text right at the ceiling', async () => {
    const res = await POST(req({ text: 'a'.repeat(300_000), format: 'text' }))
    expect(res.status).toBe(200)
  })

  it('still accepts ordinary, short text', async () => {
    const res = await POST(req({ text: 'hello world', format: 'text' }))
    expect(res.status).toBe(200)
  })
})

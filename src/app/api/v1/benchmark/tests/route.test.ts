import { describe, it, expect, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { GET } from '../health/route'
import { POST } from '../run/route'

afterEach(() => { delete process.env.HUMANITE_BENCHMARK_TOKEN })

describe('benchmark routes (wiring)', () => {
  it('return 404 when HUMANITE_BENCHMARK_TOKEN is unset', async () => {
    const h = await GET(new NextRequest('http://localhost/api/v1/benchmark/health'))
    expect(h.status).toBe(404)
    const r = await POST(new NextRequest('http://localhost/api/v1/benchmark/run', { method: 'POST', body: '{}' }))
    expect(r.status).toBe(404)
  })
  it('health returns ok with the token', async () => {
    const token = 't'.repeat(40)
    process.env.HUMANITE_BENCHMARK_TOKEN = token
    const h = await GET(new NextRequest('http://localhost/api/v1/benchmark/health', { headers: { authorization: `Bearer ${token}` } }))
    expect(h.status).toBe(200)
    expect((await h.json()).ok).toBe(true)
  })
})

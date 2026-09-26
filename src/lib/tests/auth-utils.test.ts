// @vitest-environment node
//
// jose's WebCrypto signing path checks `payload instanceof Uint8Array`
// strictly; under the project-wide jsdom test environment, TextEncoder
// produces a Uint8Array from a different realm than the one jose's own
// import runs in, and that check fails even though the real production
// runtime (a Next.js API route, plain Node) never has this problem. This
// file needs real JWT signing/verification (that's the whole point of
// testing tier/scope claims), so it opts back into the plain Node
// environment rather than jsdom's.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { issueAccessToken, verifyAccessToken } from '../auth-utils'

const ORIGINAL_JWT_SECRET = process.env.JWT_SECRET

beforeEach(() => {
  process.env.JWT_SECRET = 'test-only-secret-do-not-use-in-production'
})
afterEach(() => {
  if (ORIGINAL_JWT_SECRET === undefined) delete process.env.JWT_SECRET
  else process.env.JWT_SECRET = ORIGINAL_JWT_SECRET
})

describe('issueAccessToken / verifyAccessToken — tier and scope claims', () => {
  it('signs a gold-tier account\'s token with tier "gold" — resolving an account to Gold is exactly this', async () => {
    const token = await issueAccessToken('user-1', 'jdzelazny@gmail.com', 'gold', 'us-east1')
    const payload = await verifyAccessToken(token)
    expect(payload.tier).toBe('gold')
  })

  it('grants a gold account the same elevated scope pro/enterprise accounts get', async () => {
    const goldToken = await issueAccessToken('user-1', 'user@example.com', 'gold', 'us-east1')
    const proToken = await issueAccessToken('user-2', 'user2@example.com', 'pro', 'us-east1')
    const goldPayload = await verifyAccessToken(goldToken)
    const proPayload = await verifyAccessToken(proToken)
    expect(goldPayload.scopes).toEqual(proPayload.scopes)
    expect(goldPayload.scopes).toContain('user:read')
  })

  it('does not grant the elevated scope to a free-tier account', async () => {
    const token = await issueAccessToken('user-1', 'user@example.com', 'free', 'us-east1')
    const payload = await verifyAccessToken(token)
    expect(payload.scopes).not.toContain('user:read')
  })

  it('rejects a token whose payload was tampered with client-side to forge tier "gold"', async () => {
    // Gold privileges cannot be enabled through client-side manipulation
    // alone: a real free-tier token, edited to claim tier: 'gold' without
    // re-signing (exactly what a client holding only the token, never the
    // server's JWT_SECRET, could attempt), must fail verification outright
    // rather than being accepted with the forged claim.
    const token = await issueAccessToken('user-1', 'user@example.com', 'free', 'us-east1')
    const [header, payload, signature] = token.split('.')
    const decoded = JSON.parse(Buffer.from(payload!, 'base64url').toString('utf8'))
    expect(decoded.tier).toBe('free')
    decoded.tier = 'gold'
    const forgedPayload = Buffer.from(JSON.stringify(decoded)).toString('base64url')
    const forgedToken = `${header}.${forgedPayload}.${signature}`

    await expect(verifyAccessToken(forgedToken)).rejects.toThrow()
  })

  it('rejects a token signed with a different secret (e.g. a client guessing/brute-forcing one)', async () => {
    process.env.JWT_SECRET = 'a-different-secret-the-server-never-used'
    const wrongSecretToken = await issueAccessToken('user-1', 'user@example.com', 'gold', 'us-east1')
    process.env.JWT_SECRET = 'test-only-secret-do-not-use-in-production'

    await expect(verifyAccessToken(wrongSecretToken)).rejects.toThrow()
  })
})

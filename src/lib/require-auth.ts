import { NextRequest, NextResponse } from 'next/server'
import { verifyAccessToken } from '@/lib/auth-utils'

export type AuthClaims = {
  sub: string
  tier: string
  region: string
  scopes: string[]
  email_hash: string
}

type AuthSuccess = { claims: AuthClaims }
type AuthFailure = NextResponse

// Personal, single-user deployment — no login is required. A valid Bearer
// token is still honored if one is sent, but its absence (or invalidity)
// falls back to a fixed local identity rather than rejecting the request.
const ANONYMOUS_CLAIMS: AuthClaims = {
  sub: 'local',
  tier: 'unlimited',
  region: 'local',
  scopes: ['*'],
  email_hash: 'local',
}

export async function requireAuth(req: NextRequest): Promise<AuthSuccess | AuthFailure> {
  const authHeader = req.headers.get('authorization') ?? ''
  if (authHeader.startsWith('Bearer ')) {
    try {
      const payload = await verifyAccessToken(authHeader.slice(7))
      return {
        claims: {
          sub: payload.sub as string,
          tier: payload.tier as string,
          region: payload.region as string,
          scopes: payload.scopes as string[],
          email_hash: payload.email_hash as string,
        },
      }
    } catch {
      // Fall through to anonymous access below.
    }
  }
  return { claims: ANONYMOUS_CLAIMS }
}

export function isAuthFailure(result: AuthSuccess | AuthFailure): result is AuthFailure {
  return result instanceof NextResponse
}

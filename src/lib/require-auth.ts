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

// A valid Bearer token is required — a missing or invalid one is rejected
// outright rather than falling back to a shared anonymous identity. Every
// route below trusts `claims.sub` as a real per-user identity (usage quotas,
// stored config, presets, billing); a silent anonymous fallback would let
// all unauthenticated callers share one identity with full access instead
// of being turned away.
export async function requireAuth(req: NextRequest): Promise<AuthSuccess | AuthFailure> {
  const authHeader = req.headers.get('authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) {
    return NextResponse.json(
      { error: { code: 'AUTHENTICATION_REQUIRED', message: 'Authorization header with Bearer token required.' } },
      { status: 401 },
    )
  }
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
    return NextResponse.json(
      { error: { code: 'TOKEN_INVALID', message: 'Token is invalid or expired.' } },
      { status: 401 },
    )
  }
}

export function isAuthFailure(result: AuthSuccess | AuthFailure): result is AuthFailure {
  return result instanceof NextResponse
}

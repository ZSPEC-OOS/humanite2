import { NextRequest, NextResponse } from 'next/server'
import { verifyAccessToken } from '@/lib/auth-utils'

export type AuthClaims = {
  sub: string
  tier: string
  region: string
  scopes: string[]
  email_hash: string
  a2h_admin: boolean
  // The account's creation timestamp (ISO 8601) — see issueAccessToken's
  // own comment. Used by usageLimits.ts to compute Free-trial expiration.
  createdAt: string
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
        a2h_admin: Boolean(payload.a2h_admin),
        // Absent only on a token issued before this claim existed (a
        // pre-existing refresh token's next access token) — treated as
        // "unknown, assume not expired" by usageLimits.ts rather than
        // crashing, the same tolerant-of-legacy-tokens posture every other
        // claim here already has.
        createdAt: typeof payload.created_at === 'string' ? payload.created_at : '',
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

import { NextRequest, NextResponse } from 'next/server'
import { verifyAccessToken } from '@/lib/auth-utils'

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization') ?? ''
  if (!authHeader.startsWith('Bearer ')) {
    return NextResponse.json({ error: { code: 'AUTHENTICATION_REQUIRED', message: 'Authorization header with Bearer token required.' } }, { status: 401 })
  }
  try {
    const claims = await verifyAccessToken(authHeader.slice(7))
    return NextResponse.json({ user_id: claims.sub, email_hash: claims.email_hash, tier: claims.tier, region: claims.region, scopes: claims.scopes })
  } catch {
    return NextResponse.json({ error: { code: 'TOKEN_INVALID', message: 'Token is invalid or expired.' } }, { status: 401 })
  }
}

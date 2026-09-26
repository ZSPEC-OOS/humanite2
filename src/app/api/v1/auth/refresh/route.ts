import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/firestore'
import { hashRefreshToken, issueAccessToken } from '@/lib/auth-utils'
import { resolveEffectiveTier } from '@/lib/accountTier'
import { rotateRefreshToken } from '@/lib/refreshTokenRotation'

export async function POST(req: NextRequest) {
  let body: { refresh_token?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } }, { status: 400 })
  }

  const rawToken = body.refresh_token ?? ''
  if (!rawToken) {
    return NextResponse.json({ error: { code: 'INVALID_REFRESH_TOKEN', message: 'Refresh token is required.' } }, { status: 401 })
  }

  const tokenHash = hashRefreshToken(rawToken)
  const firestore = db()
  const rotation = await rotateRefreshToken(firestore, tokenHash)

  if (!rotation.ok) {
    return NextResponse.json({ error: { code: 'INVALID_REFRESH_TOKEN', message: 'Refresh token is invalid, expired, or already used.' } }, { status: 401 })
  }

  const userDoc = await firestore.collection('users').doc(rotation.userId!).get()
  const user = userDoc.data()
  if (!user || user.deletedAt) {
    return NextResponse.json({ error: { code: 'USER_NOT_FOUND', message: 'User not found.' } }, { status: 401 })
  }

  const accessToken = await issueAccessToken(userDoc.id, user.email, resolveEffectiveTier(user.email, user.tier), user.region)

  return NextResponse.json({
    access_token: accessToken,
    refresh_token: rotation.rawRefreshToken,
    token_type: 'bearer',
    expires_in: 900,
  })
}

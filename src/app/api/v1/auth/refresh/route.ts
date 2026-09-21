import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/firestore'
import { hashRefreshToken, issueAccessToken, generateRefreshToken } from '@/lib/auth-utils'

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
  const tokenDoc = await firestore.collection('refreshTokens').doc(tokenHash).get()

  if (!tokenDoc.exists) {
    return NextResponse.json({ error: { code: 'INVALID_REFRESH_TOKEN', message: 'Refresh token is invalid, expired, or already used.' } }, { status: 401 })
  }

  const token = tokenDoc.data()!

  // Token already revoked — revoke entire family (possible theft)
  if (token.revokedAt) {
    const familySnap = await firestore.collection('refreshTokens')
      .where('familyId', '==', token.familyId)
      .where('revokedAt', '==', null)
      .get()
    const batch = firestore.batch()
    familySnap.docs.forEach(d => batch.update(d.ref, { revokedAt: new Date() }))
    await batch.commit()
    return NextResponse.json({ error: { code: 'INVALID_REFRESH_TOKEN', message: 'Refresh token is invalid, expired, or already used.' } }, { status: 401 })
  }

  if (token.expiresAt.toDate() < new Date()) {
    return NextResponse.json({ error: { code: 'INVALID_REFRESH_TOKEN', message: 'Refresh token is invalid, expired, or already used.' } }, { status: 401 })
  }

  // Revoke used token
  await tokenDoc.ref.update({ revokedAt: new Date() })

  const userDoc = await firestore.collection('users').doc(token.userId).get()
  const user = userDoc.data()
  if (!user || user.deletedAt) {
    return NextResponse.json({ error: { code: 'USER_NOT_FOUND', message: 'User not found.' } }, { status: 401 })
  }

  const accessToken = await issueAccessToken(userDoc.id, user.email, user.tier, user.region)
  const { raw, hash } = generateRefreshToken()

  await firestore.collection('refreshTokens').doc(hash).set({
    userId: userDoc.id,
    familyId: token.familyId,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    createdAt: new Date(),
    revokedAt: null,
  })

  return NextResponse.json({ access_token: accessToken, refresh_token: raw, token_type: 'bearer', expires_in: 900 })
}

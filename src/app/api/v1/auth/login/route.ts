import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/firestore'
import { issueAccessToken, generateRefreshToken } from '@/lib/auth-utils'
import bcrypt from 'bcryptjs'
import { randomUUID } from 'crypto'

const DUMMY_HASH = '$2b$12$dummysaltdummysaltdummmusedummyhashvaluethatisnotreal1234'

export async function POST(req: NextRequest) {
  let body: { email?: string; password?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } }, { status: 400 })
  }

  const email = (body.email ?? '').trim().toLowerCase()
  const password = body.password ?? ''

  const firestore = db()
  const snap = await firestore.collection('users').where('email', '==', email).where('deletedAt', '==', null).limit(1).get()
  const userDoc = snap.empty ? null : snap.docs[0]
  const user = userDoc?.data()

  // Always run bcrypt to prevent timing attacks
  const hashToCheck = user?.passwordHash ?? DUMMY_HASH
  const passwordOk = await bcrypt.compare(password, hashToCheck)

  if (!user || !userDoc || !passwordOk) {
    return NextResponse.json({ error: { code: 'AUTHENTICATION_FAILED', message: 'Invalid email or password.' } }, { status: 401 })
  }

  const accessToken = await issueAccessToken(userDoc.id, user.email, user.tier, user.region)
  const { raw, hash } = generateRefreshToken()
  const familyId = randomUUID()

  await firestore.collection('refreshTokens').doc(hash).set({
    userId: userDoc.id,
    familyId,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    createdAt: new Date(),
    revokedAt: null,
  })

  return NextResponse.json({ access_token: accessToken, refresh_token: raw, token_type: 'bearer', expires_in: 900 })
}

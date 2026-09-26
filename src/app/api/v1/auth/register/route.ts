import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/firestore'
import { issueAccessToken, generateRefreshToken } from '@/lib/auth-utils'
import { resolveEffectiveTier } from '@/lib/accountTier'
import { registerUser } from '@/lib/userRegistration'
import { randomUUID } from 'crypto'

export async function POST(req: NextRequest) {
  let body: { email?: string; password?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } }, { status: 400 })
  }

  const email = (body.email ?? '').trim().toLowerCase()
  const password = body.password ?? ''
  if (!email || !password) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'Email and password are required.' } }, { status: 400 })
  }

  const firestore = db()
  const registration = await registerUser(firestore, email, password)
  if (!registration.ok) {
    return NextResponse.json({ error: { code: 'EMAIL_TAKEN', message: 'An account with this email already exists.' } }, { status: 409 })
  }
  const userId = registration.userId!

  const accessToken = await issueAccessToken(userId, email, resolveEffectiveTier(email, 'free'), 'us-east1')
  const { raw, hash } = generateRefreshToken()
  const familyId = randomUUID()

  await firestore.collection('refreshTokens').doc(hash).set({
    userId,
    familyId,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    createdAt: new Date(),
    revokedAt: null,
  })

  return NextResponse.json(
    { access_token: accessToken, refresh_token: raw, token_type: 'bearer', expires_in: 900 },
    { status: 201 },
  )
}

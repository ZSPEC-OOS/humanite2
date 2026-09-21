import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/firestore'
import { hashPassword, issueAccessToken, generateRefreshToken } from '@/lib/auth-utils'
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

  // Check email taken
  const existing = await firestore.collection('users').where('email', '==', email).limit(1).get()
  if (!existing.empty) {
    return NextResponse.json({ error: { code: 'EMAIL_TAKEN', message: 'An account with this email already exists.' } }, { status: 409 })
  }

  const userId = randomUUID()
  const passwordHash = await hashPassword(password)
  const now = new Date()

  await firestore.collection('users').doc(userId).set({
    email,
    passwordHash,
    tier: 'free',
    region: 'us-east1',
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  })

  const accessToken = await issueAccessToken(userId, email, 'free', 'us-east1')
  const { raw, hash } = generateRefreshToken()
  const familyId = randomUUID()

  await firestore.collection('refreshTokens').doc(hash).set({
    userId,
    familyId,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    createdAt: now,
    revokedAt: null,
  })

  return NextResponse.json(
    { access_token: accessToken, refresh_token: raw, token_type: 'bearer', expires_in: 900 },
    { status: 201 },
  )
}

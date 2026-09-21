import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/firestore'
import { requireAuth, isAuthFailure } from '@/lib/require-auth'
import { randomUUID } from 'crypto'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (isAuthFailure(auth)) return auth

  const snap = await db().collection('presets')
    .where('userId', '==', auth.claims.sub)
    .orderBy('createdAt', 'desc')
    .get()

  return NextResponse.json(snap.docs.map(d => {
    const p = d.data()
    return { id: d.id, name: p.name, intensity: p.intensity, tone: p.tone, domain: p.domain, preserve_citations: p.preserveCitations, created_at: p.createdAt.toDate().toISOString() }
  }))
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if (isAuthFailure(auth)) return auth

  let body: { name?: string; intensity?: number; tone?: string; domain?: string; preserve_citations?: boolean }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } }, { status: 400 })
  }

  const name = (body.name ?? '').trim()
  if (!name) return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'Preset name is required.' } }, { status: 400 })

  // Check name uniqueness for this user
  const existing = await db().collection('presets').where('userId', '==', auth.claims.sub).where('name', '==', name).limit(1).get()
  if (!existing.empty) {
    return NextResponse.json({ error: { code: 'PRESET_NAME_TAKEN', message: `A preset named '${name}' already exists.` } }, { status: 409 })
  }

  const id = randomUUID()
  const now = new Date()
  const data = {
    userId: auth.claims.sub,
    name,
    intensity: Math.min(10, Math.max(1, body.intensity ?? 5)),
    tone: body.tone ?? 'balanced',
    domain: body.domain ?? 'general',
    preserveCitations: body.preserve_citations ?? true,
    createdAt: now,
    updatedAt: now,
  }

  await db().collection('presets').doc(id).set(data)

  return NextResponse.json({ id, name: data.name, intensity: data.intensity, tone: data.tone, domain: data.domain, preserve_citations: data.preserveCitations, created_at: now.toISOString() }, { status: 201 })
}

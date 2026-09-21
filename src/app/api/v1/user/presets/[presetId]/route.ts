import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/firestore'
import { requireAuth, isAuthFailure } from '@/lib/require-auth'

export async function GET(req: NextRequest, { params }: { params: { presetId: string } }) {
  const auth = await requireAuth(req)
  if (isAuthFailure(auth)) return auth

  const doc = await db().collection('presets').doc(params.presetId).get()
  if (!doc.exists || doc.data()!.userId !== auth.claims.sub) {
    return NextResponse.json({ error: { code: 'PRESET_NOT_FOUND', message: 'Preset not found.' } }, { status: 404 })
  }
  const p = doc.data()!
  return NextResponse.json({ id: doc.id, name: p.name, intensity: p.intensity, tone: p.tone, domain: p.domain, preserve_citations: p.preserveCitations, created_at: p.createdAt.toDate().toISOString() })
}

export async function DELETE(req: NextRequest, { params }: { params: { presetId: string } }) {
  const auth = await requireAuth(req)
  if (isAuthFailure(auth)) return auth

  const doc = await db().collection('presets').doc(params.presetId).get()
  if (!doc.exists || doc.data()!.userId !== auth.claims.sub) {
    return NextResponse.json({ error: { code: 'PRESET_NOT_FOUND', message: 'Preset not found.' } }, { status: 404 })
  }
  await doc.ref.delete()
  return new NextResponse(null, { status: 204 })
}

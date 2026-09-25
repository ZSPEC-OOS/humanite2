import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/firestore'
import { requireAuth, isAuthFailure } from '@/lib/require-auth'

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAuth(req)
  if (isAuthFailure(auth)) return auth

  const doc = await db().collection('transformations').doc(params.id).get()
  if (!doc.exists || doc.data()!.userId !== auth.claims.sub) {
    return NextResponse.json({ error: { code: 'TRANSFORMATION_NOT_FOUND', message: 'Transformation not found.' } }, { status: 404 })
  }

  const t = doc.data()!
  return NextResponse.json({
    id: doc.id,
    created_at: t.createdAt.toDate().toISOString(),
    input_text: t.inputText,
    output: t.output,
  })
}

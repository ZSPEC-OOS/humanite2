import { NextRequest, NextResponse } from 'next/server'
import { requireA2HAdmin } from '@/lib/require-a2h-admin'
import { isAuthFailure } from '@/lib/require-auth'
import { db } from '@/lib/firestore'
import { updateFixture, deleteFixture, type FixtureUpdatePatch } from '@/lib/a2h/fixtures'

export async function PATCH(req: NextRequest, { params }: { params: { fixtureId: string } }) {
  const auth = await requireA2HAdmin(req)
  if (isAuthFailure(auth)) return auth

  let body: FixtureUpdatePatch
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } }, { status: 400 })
  }

  try {
    const fixture = await updateFixture(db(), params.fixtureId, body)
    return NextResponse.json({ fixture })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Update failed.'
    const notFound = message === 'Fixture not found.'
    return NextResponse.json(
      { error: { code: notFound ? 'NOT_FOUND' : 'CONFLICT', message } },
      { status: notFound ? 404 : 409 },
    )
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { fixtureId: string } }) {
  const auth = await requireA2HAdmin(req)
  if (isAuthFailure(auth)) return auth

  try {
    await deleteFixture(db(), params.fixtureId)
    return NextResponse.json({ deleted: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Delete failed.'
    return NextResponse.json({ error: { code: 'CONFLICT', message } }, { status: 409 })
  }
}

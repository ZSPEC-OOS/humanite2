import { NextRequest, NextResponse } from 'next/server'
import { requireA2HAdmin } from '@/lib/require-a2h-admin'
import { isAuthFailure } from '@/lib/require-auth'
import { db } from '@/lib/firestore'
import { lockFixtureSet } from '@/lib/a2h/fixtures'

export async function POST(req: NextRequest, { params }: { params: { fixtureSetId: string } }) {
  const auth = await requireA2HAdmin(req)
  if (isAuthFailure(auth)) return auth

  try {
    const { set, result } = await lockFixtureSet(db(), params.fixtureSetId)
    return NextResponse.json({ set, result })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Lock failed.'
    const notFound = message === 'Fixture set not found.'
    return NextResponse.json(
      { error: { code: notFound ? 'NOT_FOUND' : 'CONFLICT', message } },
      { status: notFound ? 404 : 409 },
    )
  }
}

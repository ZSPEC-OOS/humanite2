import { NextRequest, NextResponse } from 'next/server'
import { requireA2HAdmin } from '@/lib/require-a2h-admin'
import { isAuthFailure } from '@/lib/require-auth'
import { db } from '@/lib/firestore'
import { getFixtureSet } from '@/lib/a2h/fixtures'

export async function GET(req: NextRequest, { params }: { params: { fixtureSetId: string } }) {
  const auth = await requireA2HAdmin(req)
  if (isAuthFailure(auth)) return auth

  const fixtureSet = await getFixtureSet(db(), params.fixtureSetId)
  if (!fixtureSet) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Fixture set not found.' } }, { status: 404 })
  }
  return NextResponse.json({ fixtureSet })
}

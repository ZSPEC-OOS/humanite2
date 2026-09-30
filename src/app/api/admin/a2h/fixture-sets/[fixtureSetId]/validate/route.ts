import { NextRequest, NextResponse } from 'next/server'
import { requireA2HAdmin } from '@/lib/require-a2h-admin'
import { isAuthFailure } from '@/lib/require-auth'
import { db } from '@/lib/firestore'
import { validateFixtureSet } from '@/lib/a2h/fixtures'

// Always 200 with the full error list on a failed validation (matching the
// run validate route's convention) — an invalid fixture set is an expected,
// actionable outcome, not a server error.
export async function POST(req: NextRequest, { params }: { params: { fixtureSetId: string } }) {
  const auth = await requireA2HAdmin(req)
  if (isAuthFailure(auth)) return auth

  try {
    const result = await validateFixtureSet(db(), params.fixtureSetId)
    return NextResponse.json({ result })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Validation failed.'
    const notFound = message === 'Fixture set not found.'
    return NextResponse.json(
      { error: { code: notFound ? 'NOT_FOUND' : 'CONFLICT', message } },
      { status: notFound ? 404 : 409 },
    )
  }
}

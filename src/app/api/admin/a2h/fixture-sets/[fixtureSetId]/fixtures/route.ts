import { NextRequest, NextResponse } from 'next/server'
import { requireA2HAdmin } from '@/lib/require-a2h-admin'
import { isAuthFailure } from '@/lib/require-auth'
import { db } from '@/lib/firestore'
import { createFixture, listFixturesForSet, listFixturesForSource, type CreateFixtureInput } from '@/lib/a2h/fixtures'

export async function GET(req: NextRequest, { params }: { params: { fixtureSetId: string } }) {
  const auth = await requireA2HAdmin(req)
  if (isAuthFailure(auth)) return auth

  const sourceId = req.nextUrl.searchParams.get('sourceId')
  const fixtures = sourceId
    ? await listFixturesForSource(db(), params.fixtureSetId, sourceId)
    : await listFixturesForSet(db(), params.fixtureSetId)
  return NextResponse.json({ fixtures })
}

interface CreateBody {
  sourceId?: string
  type?: CreateFixtureInput['type']
  expected?: Record<string, unknown>
  ordinal?: number
  sourceStart?: number | null
  sourceEnd?: number | null
  sourceText?: string | null
  notes?: string | null
}

export async function POST(req: NextRequest, { params }: { params: { fixtureSetId: string } }) {
  const auth = await requireA2HAdmin(req)
  if (isAuthFailure(auth)) return auth

  let body: CreateBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } }, { status: 400 })
  }
  if (!body.sourceId || !body.type || !body.expected) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'sourceId, type, and expected are required.' } }, { status: 400 })
  }

  try {
    const fixture = await createFixture(db(), {
      fixtureSetId: params.fixtureSetId,
      sourceId: body.sourceId,
      type: body.type,
      expected: body.expected,
      ...(body.ordinal !== undefined ? { ordinal: body.ordinal } : {}),
      ...(body.sourceStart !== undefined ? { sourceStart: body.sourceStart } : {}),
      ...(body.sourceEnd !== undefined ? { sourceEnd: body.sourceEnd } : {}),
      ...(body.sourceText !== undefined ? { sourceText: body.sourceText } : {}),
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
    })
    return NextResponse.json({ fixture }, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create fixture.'
    const notFound = message === 'Fixture set not found.' || message === 'Source not found.'
    return NextResponse.json(
      { error: { code: notFound ? 'NOT_FOUND' : 'VALIDATION_ERROR', message } },
      { status: notFound ? 404 : 400 },
    )
  }
}

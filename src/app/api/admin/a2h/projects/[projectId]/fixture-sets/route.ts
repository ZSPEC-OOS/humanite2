import { NextRequest, NextResponse } from 'next/server'
import { requireA2HAdmin } from '@/lib/require-a2h-admin'
import { isAuthFailure } from '@/lib/require-auth'
import { db } from '@/lib/firestore'
import { createFixtureSet, listFixtureSetsForProject } from '@/lib/a2h/fixtures'

export async function GET(req: NextRequest, { params }: { params: { projectId: string } }) {
  const auth = await requireA2HAdmin(req)
  if (isAuthFailure(auth)) return auth

  const fixtureSets = await listFixtureSetsForProject(db(), params.projectId)
  return NextResponse.json({ fixtureSets })
}

interface CreateBody {
  name?: string
}

export async function POST(req: NextRequest, { params }: { params: { projectId: string } }) {
  const auth = await requireA2HAdmin(req)
  if (isAuthFailure(auth)) return auth

  let body: CreateBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } }, { status: 400 })
  }

  try {
    const fixtureSet = await createFixtureSet(db(), { corpusProjectId: params.projectId, name: body.name ?? '' })
    return NextResponse.json({ fixtureSet }, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create fixture set.'
    const notFound = message === 'Corpus project not found.'
    return NextResponse.json(
      { error: { code: notFound ? 'NOT_FOUND' : 'VALIDATION_ERROR', message } },
      { status: notFound ? 404 : 400 },
    )
  }
}

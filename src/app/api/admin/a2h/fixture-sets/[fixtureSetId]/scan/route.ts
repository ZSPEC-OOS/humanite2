import { NextRequest, NextResponse } from 'next/server'
import { requireA2HAdmin } from '@/lib/require-a2h-admin'
import { isAuthFailure } from '@/lib/require-auth'
import { db } from '@/lib/firestore'
import { getFixtureSet, scanSourceForCandidates } from '@/lib/a2h/fixtures'
import { getSourceById } from '@/lib/a2h/corpus'

interface ScanBody {
  sourceId?: string
}

// Deterministic-extraction-assisted fixture creation (§22/§23) — proposes
// candidates for the admin to review; nothing here is persisted.
export async function POST(req: NextRequest, { params }: { params: { fixtureSetId: string } }) {
  const auth = await requireA2HAdmin(req)
  if (isAuthFailure(auth)) return auth

  let body: ScanBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } }, { status: 400 })
  }
  if (!body.sourceId) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'sourceId is required.' } }, { status: 400 })
  }

  const fixtureSet = await getFixtureSet(db(), params.fixtureSetId)
  if (!fixtureSet) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Fixture set not found.' } }, { status: 404 })
  }
  const source = await getSourceById(db(), body.sourceId)
  if (!source || source.corpusProjectId !== fixtureSet.corpusProjectId) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Source not found in this fixture set\'s corpus project.' } }, { status: 404 })
  }

  const candidates = scanSourceForCandidates(source.text)
  return NextResponse.json({ candidates })
}

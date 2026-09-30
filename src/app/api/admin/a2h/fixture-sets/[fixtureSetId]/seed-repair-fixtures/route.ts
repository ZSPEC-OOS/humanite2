import { NextRequest, NextResponse } from 'next/server'
import { requireA2HAdmin } from '@/lib/require-a2h-admin'
import { isAuthFailure } from '@/lib/require-auth'
import { db } from '@/lib/firestore'
import { createFixture } from '@/lib/a2h/fixtures'
import { proposeGrammarRepairCandidates } from '@/lib/a2h/a2h06'
import { proposeFactualRepairCandidates } from '@/lib/a2h/a2h12'

interface SeedBody {
  sourceId?: string
  kind?: 'grammar_repair' | 'factual_repair'
}

// Assisted fixture creation (§29-30) for the two controlled-derivative
// types: bulk-imports the curated, deterministic seed set (§7/§20) onto a
// chosen frozen source in one call. Nothing here is auto-locked — an admin
// still reviews and locks the fixture set explicitly. Calling this twice
// for the same source adds a second copy of each seed fixture (distinct
// ordinals) rather than silently deduplicating; re-seeding an already-
// seeded source is a known, documented limitation of this first pass.
export async function POST(req: NextRequest, { params }: { params: { fixtureSetId: string } }) {
  const auth = await requireA2HAdmin(req)
  if (isAuthFailure(auth)) return auth

  let body: SeedBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } }, { status: 400 })
  }
  if (!body.sourceId || !body.kind) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'sourceId and kind are required.' } }, { status: 400 })
  }

  const candidates = body.kind === 'grammar_repair' ? proposeGrammarRepairCandidates() : proposeFactualRepairCandidates()

  try {
    const fixtures = await Promise.all(candidates.map(expected => createFixture(db(), {
      fixtureSetId: params.fixtureSetId,
      sourceId: body.sourceId!,
      type: body.kind!,
      expected: expected as unknown as Record<string, unknown>,
    })))
    return NextResponse.json({ fixtures }, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to seed fixtures.'
    const notFound = message === 'Fixture set not found.' || message === 'Source not found.'
    return NextResponse.json(
      { error: { code: notFound ? 'NOT_FOUND' : 'VALIDATION_ERROR', message } },
      { status: notFound ? 404 : 400 },
    )
  }
}

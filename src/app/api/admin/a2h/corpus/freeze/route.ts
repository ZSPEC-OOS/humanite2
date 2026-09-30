import { NextRequest, NextResponse } from 'next/server'
import { requireA2HAdmin } from '@/lib/require-a2h-admin'
import { isAuthFailure } from '@/lib/require-auth'
import { db } from '@/lib/firestore'
import { freezeSource } from '@/lib/a2h/corpus'

interface FreezeBody {
  corpusProjectId?: string
  topicId?: string
  targetWords?: number
}

// Freezing is its own explicit call (never a side effect of generation) per
// §23: "Corpus freezing should require an explicit confirmation step because
// downstream benchmark comparability depends on immutability." This freezes
// one source cell — see /api/admin/a2h/projects/[projectId]/freeze for the
// whole-project milestone.
export async function POST(req: NextRequest) {
  const auth = await requireA2HAdmin(req)
  if (isAuthFailure(auth)) return auth

  let body: FreezeBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } }, { status: 400 })
  }

  if (!body.corpusProjectId || !body.topicId || !body.targetWords) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'corpusProjectId, topicId, and targetWords are required.' } }, { status: 400 })
  }

  try {
    const source = await freezeSource(db(), body.corpusProjectId, body.topicId, body.targetWords)
    return NextResponse.json({ source })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Freeze failed.'
    return NextResponse.json({ error: { code: 'FREEZE_FAILED', message } }, { status: 409 })
  }
}

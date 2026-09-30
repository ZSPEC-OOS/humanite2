import { NextRequest, NextResponse } from 'next/server'
import { requireA2HAdmin } from '@/lib/require-a2h-admin'
import { isAuthFailure } from '@/lib/require-auth'
import { db } from '@/lib/firestore'
import { duplicateCorpusProject } from '@/lib/a2h/corpusProject'

interface DuplicateBody {
  name?: string
}

// Copies configuration and the generated topic blueprint into a new,
// isolated project — never the generated corpus sources, detector results,
// or Humanite outputs. Lets an admin try a different layout without
// rebuilding everything by hand.
export async function POST(req: NextRequest, { params }: { params: { projectId: string } }) {
  const auth = await requireA2HAdmin(req)
  if (isAuthFailure(auth)) return auth

  let body: DuplicateBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } }, { status: 400 })
  }

  try {
    const project = await duplicateCorpusProject(db(), params.projectId, body.name ?? '')
    return NextResponse.json({ project }, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Duplicate failed.'
    const notFound = message === 'Corpus project not found.'
    return NextResponse.json(
      { error: { code: notFound ? 'NOT_FOUND' : 'VALIDATION_ERROR', message } },
      { status: notFound ? 404 : 400 },
    )
  }
}

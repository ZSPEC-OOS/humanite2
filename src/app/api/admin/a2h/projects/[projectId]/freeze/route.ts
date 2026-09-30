import { NextRequest, NextResponse } from 'next/server'
import { requireA2HAdmin } from '@/lib/require-a2h-admin'
import { isAuthFailure } from '@/lib/require-auth'
import { db } from '@/lib/firestore'
import { freezeCorpusProject } from '@/lib/a2h/corpusProject'

// The project-level milestone marker — distinct from freezing an individual
// CorpusSource (see /api/admin/a2h/corpus/freeze). Requires explicit
// confirmation per §23, same as any other freeze action in this system.
export async function POST(req: NextRequest, { params }: { params: { projectId: string } }) {
  const auth = await requireA2HAdmin(req)
  if (isAuthFailure(auth)) return auth

  try {
    const project = await freezeCorpusProject(db(), params.projectId)
    return NextResponse.json({ project })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Freeze failed.'
    const notFound = message === 'Corpus project not found.'
    return NextResponse.json(
      { error: { code: notFound ? 'NOT_FOUND' : 'CONFLICT', message } },
      { status: notFound ? 404 : 409 },
    )
  }
}

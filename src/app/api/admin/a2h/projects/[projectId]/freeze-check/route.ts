import { NextRequest, NextResponse } from 'next/server'
import { requireA2HAdmin } from '@/lib/require-a2h-admin'
import { isAuthFailure } from '@/lib/require-auth'
import { db } from '@/lib/firestore'
import { getCorpusProject, validateCorpusForFreeze } from '@/lib/a2h/corpusProject'

// Read-only preview of whole-corpus freeze readiness — lets the UI show
// "Cannot freeze corpus: expected 1,200, frozen 1,190, missing 4, not
// frozen 6" before the admin even attempts the freeze, rather than
// discovering it from a single rejected POST.
export async function GET(req: NextRequest, { params }: { params: { projectId: string } }) {
  const auth = await requireA2HAdmin(req)
  if (isAuthFailure(auth)) return auth

  const project = await getCorpusProject(db(), params.projectId)
  if (!project) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Corpus project not found.' } }, { status: 404 })
  }

  const validation = await validateCorpusForFreeze(db(), project)
  return NextResponse.json({ validation })
}

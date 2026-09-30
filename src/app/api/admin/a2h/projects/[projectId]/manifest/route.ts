import { NextRequest, NextResponse } from 'next/server'
import { requireA2HAdmin } from '@/lib/require-a2h-admin'
import { isAuthFailure } from '@/lib/require-auth'
import { db } from '@/lib/firestore'
import { getCorpusManifest } from '@/lib/a2h/corpusProject'

// The immutable manifest written once by freezeCorpusProject — absent for
// any project that has never been frozen.
export async function GET(req: NextRequest, { params }: { params: { projectId: string } }) {
  const auth = await requireA2HAdmin(req)
  if (isAuthFailure(auth)) return auth

  const manifest = await getCorpusManifest(db(), params.projectId)
  if (!manifest) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'No manifest exists — this project has not been frozen.' } }, { status: 404 })
  }
  return NextResponse.json({ manifest })
}

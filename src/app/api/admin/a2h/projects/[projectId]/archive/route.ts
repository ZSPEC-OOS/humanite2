import { NextRequest, NextResponse } from 'next/server'
import { requireA2HAdmin } from '@/lib/require-a2h-admin'
import { isAuthFailure } from '@/lib/require-auth'
import { db } from '@/lib/firestore'
import { archiveCorpusProject } from '@/lib/a2h/corpusProject'

export async function POST(req: NextRequest, { params }: { params: { projectId: string } }) {
  const auth = await requireA2HAdmin(req)
  if (isAuthFailure(auth)) return auth

  try {
    const project = await archiveCorpusProject(db(), params.projectId)
    return NextResponse.json({ project })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Archive failed.'
    return NextResponse.json({ error: { code: 'NOT_FOUND', message } }, { status: 404 })
  }
}

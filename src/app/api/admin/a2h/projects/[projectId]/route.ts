import { NextRequest, NextResponse } from 'next/server'
import { requireA2HAdmin } from '@/lib/require-a2h-admin'
import { isAuthFailure } from '@/lib/require-auth'
import { db } from '@/lib/firestore'
import { getCorpusProject, updateProjectDraft, type ProjectDraftPatch } from '@/lib/a2h/corpusProject'

export async function GET(req: NextRequest, { params }: { params: { projectId: string } }) {
  const auth = await requireA2HAdmin(req)
  if (isAuthFailure(auth)) return auth

  const project = await getCorpusProject(db(), params.projectId)
  if (!project) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Corpus project not found.' } }, { status: 404 })
  }
  return NextResponse.json({ project })
}

export async function PATCH(req: NextRequest, { params }: { params: { projectId: string } }) {
  const auth = await requireA2HAdmin(req)
  if (isAuthFailure(auth)) return auth

  let body: ProjectDraftPatch
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } }, { status: 400 })
  }

  try {
    const project = await updateProjectDraft(db(), params.projectId, body)
    return NextResponse.json({ project })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Update failed.'
    const notFound = message === 'Corpus project not found.'
    return NextResponse.json(
      { error: { code: notFound ? 'NOT_FOUND' : 'VALIDATION_ERROR', message } },
      { status: notFound ? 404 : 400 },
    )
  }
}

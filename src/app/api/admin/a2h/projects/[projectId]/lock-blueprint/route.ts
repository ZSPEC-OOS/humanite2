import { NextRequest, NextResponse } from 'next/server'
import { requireA2HAdmin } from '@/lib/require-a2h-admin'
import { isAuthFailure } from '@/lib/require-auth'
import { db } from '@/lib/firestore'
import { lockBlueprint } from '@/lib/a2h/corpusProject'

export async function POST(req: NextRequest, { params }: { params: { projectId: string } }) {
  const auth = await requireA2HAdmin(req)
  if (isAuthFailure(auth)) return auth

  try {
    const project = await lockBlueprint(db(), params.projectId)
    return NextResponse.json({ project })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Lock failed.'
    const notFound = message === 'Corpus project not found.'
    return NextResponse.json(
      { error: { code: notFound ? 'NOT_FOUND' : 'CONFLICT', message } },
      { status: notFound ? 404 : 409 },
    )
  }
}

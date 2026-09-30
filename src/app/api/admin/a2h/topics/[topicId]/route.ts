import { NextRequest, NextResponse } from 'next/server'
import { requireA2HAdmin } from '@/lib/require-a2h-admin'
import { isAuthFailure } from '@/lib/require-auth'
import { db } from '@/lib/firestore'
import { parseTopicPatch } from '@/lib/a2h/topics'
import { updateTopicChecked } from '@/lib/a2h/topicMutations'

export async function PATCH(req: NextRequest, { params }: { params: { topicId: string } }) {
  const auth = await requireA2HAdmin(req)
  if (isAuthFailure(auth)) return auth

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } }, { status: 400 })
  }

  const patch = parseTopicPatch(body)

  try {
    const topic = await updateTopicChecked(db(), params.topicId, patch)
    return NextResponse.json({ topic })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update topic.'
    const notFound = message === 'Topic not found.' || message === 'Corpus project not found.'
    return NextResponse.json(
      { error: { code: notFound ? 'NOT_FOUND' : 'VALIDATION_ERROR', message } },
      { status: notFound ? 404 : 400 },
    )
  }
}

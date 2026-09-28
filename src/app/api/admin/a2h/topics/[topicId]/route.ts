import { NextRequest, NextResponse } from 'next/server'
import { requireA2HAdmin } from '@/lib/require-a2h-admin'
import { isAuthFailure } from '@/lib/require-auth'
import { db } from '@/lib/firestore'
import { getTopic, updateTopic, parseTopicPatch } from '@/lib/a2h/topics'

export async function PATCH(req: NextRequest, { params }: { params: { topicId: string } }) {
  const auth = await requireA2HAdmin(req)
  if (isAuthFailure(auth)) return auth

  const existing = await getTopic(db(), params.topicId)
  if (!existing) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Topic not found.' } }, { status: 404 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } }, { status: 400 })
  }

  const patch = parseTopicPatch(body)
  await updateTopic(db(), params.topicId, patch)
  return NextResponse.json({ topic: { ...existing, ...patch } })
}

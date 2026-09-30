import { NextRequest, NextResponse } from 'next/server'
import { requireA2HAdmin } from '@/lib/require-a2h-admin'
import { isAuthFailure } from '@/lib/require-auth'
import { db } from '@/lib/firestore'
import { getRun, updateRunDraft, type RunDraftPatch } from '@/lib/a2h/runs'

export async function GET(req: NextRequest, { params }: { params: { runId: string } }) {
  const auth = await requireA2HAdmin(req)
  if (isAuthFailure(auth)) return auth

  const run = await getRun(db(), params.runId)
  if (!run) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Benchmark run not found.' } }, { status: 404 })
  }
  return NextResponse.json({ run })
}

export async function PATCH(req: NextRequest, { params }: { params: { runId: string } }) {
  const auth = await requireA2HAdmin(req)
  if (isAuthFailure(auth)) return auth

  let body: RunDraftPatch
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } }, { status: 400 })
  }

  try {
    const run = await updateRunDraft(db(), params.runId, body)
    return NextResponse.json({ run })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Update failed.'
    const notFound = message === 'Benchmark run not found.'
    return NextResponse.json(
      { error: { code: notFound ? 'NOT_FOUND' : 'VALIDATION_ERROR', message } },
      { status: notFound ? 404 : 400 },
    )
  }
}

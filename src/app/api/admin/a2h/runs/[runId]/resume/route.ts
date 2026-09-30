import { NextRequest, NextResponse } from 'next/server'
import { requireA2HAdmin } from '@/lib/require-a2h-admin'
import { isAuthFailure } from '@/lib/require-auth'
import { db } from '@/lib/firestore'
import { resumeRun } from '@/lib/a2h/runs'

// Phase 5A (§18): resume always reconciles interrupted work first — the
// response carries both the resumed run and a summary of what recovery
// found/fixed, so the admin UI can show "Recovery complete" feedback.
export async function POST(req: NextRequest, { params }: { params: { runId: string } }) {
  const auth = await requireA2HAdmin(req)
  if (isAuthFailure(auth)) return auth

  try {
    const { run, recovery } = await resumeRun(db(), params.runId)
    return NextResponse.json({ run, recovery })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Resume failed.'
    const notFound = message === 'Benchmark run not found.'
    return NextResponse.json(
      { error: { code: notFound ? 'NOT_FOUND' : 'CONFLICT', message } },
      { status: notFound ? 404 : 409 },
    )
  }
}

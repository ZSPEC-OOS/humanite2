import { NextRequest, NextResponse } from 'next/server'
import { requireA2HAdmin } from '@/lib/require-a2h-admin'
import { isAuthFailure } from '@/lib/require-auth'
import { db } from '@/lib/firestore'
import { validateReleaseReadiness, createRelease, getReleaseForRun } from '@/lib/a2h/release'

// GET: the release readiness checklist plus any existing release for this
// run — the admin UI's "before you freeze" view.
export async function GET(req: NextRequest, { params }: { params: { runId: string } }) {
  const auth = await requireA2HAdmin(req)
  if (isAuthFailure(auth)) return auth

  const [readiness, release] = await Promise.all([
    validateReleaseReadiness(db(), params.runId),
    getReleaseForRun(db(), params.runId),
  ])
  return NextResponse.json({ readiness, release })
}

// POST: freeze the release — only succeeds once validateReleaseReadiness
// passes; always returns 200 with the failure list on a failed attempt
// (an incomplete checklist is an expected, actionable outcome, not a server
// error), matching the run-validate route's own convention.
export async function POST(req: NextRequest, { params }: { params: { runId: string } }) {
  const auth = await requireA2HAdmin(req)
  if (isAuthFailure(auth)) return auth

  try {
    const result = await createRelease(db(), params.runId)
    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Release failed.'
    return NextResponse.json({ error: { code: 'RELEASE_FAILED', message } }, { status: 500 })
  }
}

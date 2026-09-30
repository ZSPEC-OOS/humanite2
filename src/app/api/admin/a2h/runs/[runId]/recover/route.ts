import { NextRequest, NextResponse } from 'next/server'
import { requireA2HAdmin } from '@/lib/require-a2h-admin'
import { isAuthFailure } from '@/lib/require-auth'
import { db } from '@/lib/firestore'
import { recoverRun } from '@/lib/a2h/runs'

// Phase 5A (§19/§34): the admin's explicit "Recover Interrupted Work"
// action — reconciles stale/interrupted jobs for a paused, needs_attention,
// or running run WITHOUT changing its status, so an admin can inspect (or
// force) reconciliation after a browser crash, network outage, or
// deployment before deciding whether to Resume or Retry Failed Jobs.
export async function POST(req: NextRequest, { params }: { params: { runId: string } }) {
  const auth = await requireA2HAdmin(req)
  if (isAuthFailure(auth)) return auth

  try {
    const { run, recovery } = await recoverRun(db(), params.runId)
    return NextResponse.json({ run, recovery })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Recovery failed.'
    const notFound = message === 'Benchmark run not found.'
    return NextResponse.json({ error: { code: notFound ? 'NOT_FOUND' : 'CONFLICT', message } }, { status: notFound ? 404 : 409 })
  }
}

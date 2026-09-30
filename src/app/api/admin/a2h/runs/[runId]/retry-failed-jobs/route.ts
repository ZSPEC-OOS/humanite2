import { NextRequest, NextResponse } from 'next/server'
import { requireA2HAdmin } from '@/lib/require-a2h-admin'
import { isAuthFailure } from '@/lib/require-auth'
import { db } from '@/lib/firestore'
import { retryFailedJobsAction } from '@/lib/a2h/runs'

// The explicit admin action a 'needs_attention' run requires before it can
// be released — resets every failed job to queued and puts the run back to
// 'running' for another pass (the next executeRunBatch call or cron tick).
export async function POST(req: NextRequest, { params }: { params: { runId: string } }) {
  const auth = await requireA2HAdmin(req)
  if (isAuthFailure(auth)) return auth

  try {
    const { run, retriedCount } = await retryFailedJobsAction(db(), params.runId)
    return NextResponse.json({ run, retriedCount })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Retry failed.'
    const notFound = message === 'Benchmark run not found.'
    return NextResponse.json({ error: { code: notFound ? 'NOT_FOUND' : 'CONFLICT', message } }, { status: notFound ? 404 : 409 })
  }
}

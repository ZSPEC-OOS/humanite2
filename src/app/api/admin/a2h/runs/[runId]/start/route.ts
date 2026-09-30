import { NextRequest, NextResponse } from 'next/server'
import { requireA2HAdmin } from '@/lib/require-a2h-admin'
import { isAuthFailure } from '@/lib/require-auth'
import { db } from '@/lib/firestore'
import { startRun } from '@/lib/a2h/runs'

// Transitions a validated run to 'running' and enqueues its baseline_gptzero
// jobs — see execute/route.ts for the interactive batch driver that
// actually performs the checkpointed work. This route itself makes no
// model/detector calls.
export async function POST(req: NextRequest, { params }: { params: { runId: string } }) {
  const auth = await requireA2HAdmin(req)
  if (isAuthFailure(auth)) return auth

  try {
    const run = await startRun(db(), params.runId)
    return NextResponse.json({ run })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Start failed.'
    const notFound = message === 'Benchmark run not found.'
    return NextResponse.json(
      { error: { code: notFound ? 'NOT_FOUND' : 'CONFLICT', message } },
      { status: notFound ? 404 : 409 },
    )
  }
}

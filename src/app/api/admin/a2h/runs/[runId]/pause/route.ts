import { NextRequest, NextResponse } from 'next/server'
import { requireA2HAdmin } from '@/lib/require-a2h-admin'
import { isAuthFailure } from '@/lib/require-auth'
import { db } from '@/lib/firestore'
import { pauseRun } from '@/lib/a2h/runs'

export async function POST(req: NextRequest, { params }: { params: { runId: string } }) {
  const auth = await requireA2HAdmin(req)
  if (isAuthFailure(auth)) return auth

  try {
    const run = await pauseRun(db(), params.runId)
    return NextResponse.json({ run })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Pause failed.'
    const notFound = message === 'Benchmark run not found.'
    return NextResponse.json(
      { error: { code: notFound ? 'NOT_FOUND' : 'CONFLICT', message } },
      { status: notFound ? 404 : 409 },
    )
  }
}

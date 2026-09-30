import { NextRequest, NextResponse } from 'next/server'
import { requireA2HAdmin } from '@/lib/require-a2h-admin'
import { isAuthFailure } from '@/lib/require-auth'
import { db } from '@/lib/firestore'
import { getRunProgress } from '@/lib/a2h/runs'

export async function GET(req: NextRequest, { params }: { params: { runId: string } }) {
  const auth = await requireA2HAdmin(req)
  if (isAuthFailure(auth)) return auth

  try {
    const progress = await getRunProgress(db(), params.runId)
    return NextResponse.json({ progress })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to load progress.'
    const notFound = message === 'Benchmark run not found.'
    return NextResponse.json({ error: { code: notFound ? 'NOT_FOUND' : 'ERROR', message } }, { status: notFound ? 404 : 500 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { requireA2HAdmin } from '@/lib/require-a2h-admin'
import { isAuthFailure } from '@/lib/require-auth'
import { db } from '@/lib/firestore'
import { getRun } from '@/lib/a2h/runs'
import { getA2H14Report } from '@/lib/a2h/a2h14'

export async function GET(req: NextRequest, { params }: { params: { runId: string } }) {
  const auth = await requireA2HAdmin(req)
  if (isAuthFailure(auth)) return auth

  const run = await getRun(db(), params.runId)
  if (!run) return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Run not found.' } }, { status: 404 })

  const contrasts = run.experimentConfig?.genreAudience?.contrasts ?? []
  const report = await getA2H14Report(db(), params.runId, contrasts)
  return NextResponse.json(report)
}

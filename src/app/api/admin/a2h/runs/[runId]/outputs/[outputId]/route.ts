import { NextRequest, NextResponse } from 'next/server'
import { requireA2HAdmin } from '@/lib/require-a2h-admin'
import { isAuthFailure } from '@/lib/require-auth'
import { db } from '@/lib/firestore'
import { getOutputDetail } from '@/lib/a2h/outputDetail'

export async function GET(req: NextRequest, { params }: { params: { runId: string; outputId: string } }) {
  const auth = await requireA2HAdmin(req)
  if (isAuthFailure(auth)) return auth

  const detail = await getOutputDetail(db(), params.runId, params.outputId)
  if (!detail) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Output not found for this run.' } }, { status: 404 })
  }
  return NextResponse.json({ detail })
}

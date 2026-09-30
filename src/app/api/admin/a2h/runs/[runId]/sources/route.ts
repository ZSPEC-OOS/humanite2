import { NextRequest, NextResponse } from 'next/server'
import { requireA2HAdmin } from '@/lib/require-a2h-admin'
import { isAuthFailure } from '@/lib/require-auth'
import { db } from '@/lib/firestore'
import { listRunSources } from '@/lib/a2h/runs'

// The frozen source cohort (§6) — empty until the run has been validated.
export async function GET(req: NextRequest, { params }: { params: { runId: string } }) {
  const auth = await requireA2HAdmin(req)
  if (isAuthFailure(auth)) return auth

  const sources = await listRunSources(db(), params.runId)
  return NextResponse.json({ sources })
}

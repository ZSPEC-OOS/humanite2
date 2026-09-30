import { NextRequest, NextResponse } from 'next/server'
import { requireA2HAdmin } from '@/lib/require-a2h-admin'
import { isAuthFailure } from '@/lib/require-auth'
import { db } from '@/lib/firestore'
import { getReleaseForRun, verifyReleaseIntegrity } from '@/lib/a2h/release'

// Recomputes every stored hash from the current raw records and compares —
// an on-demand audit that a released run's published numbers still match
// what was actually frozen (§"stored hashes recompute correctly").
export async function GET(req: NextRequest, { params }: { params: { runId: string } }) {
  const auth = await requireA2HAdmin(req)
  if (isAuthFailure(auth)) return auth

  const release = await getReleaseForRun(db(), params.runId)
  if (!release) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'This run has no release to verify.' } }, { status: 404 })
  }
  const result = await verifyReleaseIntegrity(db(), release.id)
  return NextResponse.json(result)
}

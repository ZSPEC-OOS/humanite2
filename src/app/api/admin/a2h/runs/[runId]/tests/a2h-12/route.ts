import { NextRequest, NextResponse } from 'next/server'
import { requireA2HAdmin } from '@/lib/require-a2h-admin'
import { isAuthFailure } from '@/lib/require-auth'
import { db } from '@/lib/firestore'
import { getA2H12Report } from '@/lib/a2h/a2h12'

// Fixture-scoped (§17) — same as A2H-06, no domain/length/intensity filters.
export async function GET(req: NextRequest, { params }: { params: { runId: string } }) {
  const auth = await requireA2HAdmin(req)
  if (isAuthFailure(auth)) return auth

  const report = await getA2H12Report(db(), params.runId)
  return NextResponse.json(report)
}

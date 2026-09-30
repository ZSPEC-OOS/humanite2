import { NextRequest, NextResponse } from 'next/server'
import { requireA2HAdmin } from '@/lib/require-a2h-admin'
import { isAuthFailure } from '@/lib/require-auth'
import { db } from '@/lib/firestore'
import { getA2H06Report } from '@/lib/a2h/a2h06'

// Fixture-scoped (§9) — unlike the output-scoped test report routes, this
// takes no domain/length/intensity filters, since a grammar_repair fixture
// carries none of those dimensions.
export async function GET(req: NextRequest, { params }: { params: { runId: string } }) {
  const auth = await requireA2HAdmin(req)
  if (isAuthFailure(auth)) return auth

  const report = await getA2H06Report(db(), params.runId)
  return NextResponse.json(report)
}

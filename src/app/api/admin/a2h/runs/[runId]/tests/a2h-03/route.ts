import { NextRequest, NextResponse } from 'next/server'
import { requireA2HAdmin } from '@/lib/require-a2h-admin'
import { isAuthFailure } from '@/lib/require-auth'
import { db } from '@/lib/firestore'
import { getA2H03Report, type A2H03Filters, type A2H03Stratum } from '@/lib/a2h/a2h03'
import { DOMAINS, type Domain } from '@/lib/style/types'

const STRATA: readonly A2H03Stratum[] = ['domain', 'topic', 'intensity']

// A2H-03 makes no Humanite or GPTZero calls (§18) — this route only ever
// reads already-persisted A2H-01/A2H-02 test results and aggregates them by
// source.targetWords.
export async function GET(req: NextRequest, { params }: { params: { runId: string } }) {
  const auth = await requireA2HAdmin(req)
  if (isAuthFailure(auth)) return auth

  const sp = req.nextUrl.searchParams
  const domainParam = sp.get('domainId')
  const domainId = domainParam && (DOMAINS as readonly string[]).includes(domainParam) ? (domainParam as Domain) : undefined
  const topicId = sp.get('topicId') ?? undefined
  const intensityParam = sp.get('intensity')

  const filters: A2H03Filters = {
    ...(domainId ? { domainId } : {}),
    ...(topicId ? { topicId } : {}),
    ...(intensityParam ? { intensity: Number(intensityParam) } : {}),
  }

  const stratifyParam = sp.get('stratifyBy')
  const stratifyBy = stratifyParam && (STRATA as readonly string[]).includes(stratifyParam) ? (stratifyParam as A2H03Stratum) : undefined

  const report = await getA2H03Report(db(), params.runId, filters, stratifyBy)
  return NextResponse.json(report)
}

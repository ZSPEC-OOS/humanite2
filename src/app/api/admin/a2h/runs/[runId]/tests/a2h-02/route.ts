import { NextRequest, NextResponse } from 'next/server'
import { requireA2HAdmin } from '@/lib/require-a2h-admin'
import { isAuthFailure } from '@/lib/require-auth'
import { db } from '@/lib/firestore'
import { getA2H02Report, type A2H02Filters } from '@/lib/a2h/a2h02'
import { DOMAINS, type Domain } from '@/lib/style/types'

export async function GET(req: NextRequest, { params }: { params: { runId: string } }) {
  const auth = await requireA2HAdmin(req)
  if (isAuthFailure(auth)) return auth

  const sp = req.nextUrl.searchParams
  const domainParam = sp.get('domainId')
  const domainId = domainParam && (DOMAINS as readonly string[]).includes(domainParam) ? (domainParam as Domain) : undefined
  const topicId = sp.get('topicId') ?? undefined
  const targetWordsParam = sp.get('targetWords')

  const filters: A2H02Filters = {
    ...(domainId ? { domainId } : {}),
    ...(topicId ? { topicId } : {}),
    ...(targetWordsParam ? { targetWords: Number(targetWordsParam) } : {}),
  }

  const report = await getA2H02Report(db(), params.runId, filters)
  return NextResponse.json(report)
}

import { NextRequest, NextResponse } from 'next/server'
import { requireA2HAdmin } from '@/lib/require-a2h-admin'
import { isAuthFailure } from '@/lib/require-auth'
import { db } from '@/lib/firestore'
import { getA2H01Report, type A2H01Filters } from '@/lib/a2h/a2h01'
import { DOMAINS, type Domain } from '@/lib/style/types'

export async function GET(req: NextRequest, { params }: { params: { runId: string } }) {
  const auth = await requireA2HAdmin(req)
  if (isAuthFailure(auth)) return auth

  const sp = req.nextUrl.searchParams
  const domainParam = sp.get('domainId')
  const domainId = domainParam && (DOMAINS as readonly string[]).includes(domainParam) ? (domainParam as Domain) : undefined
  const topicId = sp.get('topicId') ?? undefined
  const targetWordsParam = sp.get('targetWords')
  const intensityParam = sp.get('intensity')
  const classificationBefore = sp.get('classificationBefore') as A2H01Filters['classificationBefore'] | null
  const classificationAfter = sp.get('classificationAfter') as A2H01Filters['classificationAfter'] | null

  // Built incrementally (rather than one literal with `?? undefined`
  // fallbacks) because exactOptionalPropertyTypes rejects an explicit
  // `undefined` value for an optional property — only an absent key
  // satisfies "not provided" under that setting.
  const filters: A2H01Filters = {
    ...(domainId ? { domainId } : {}),
    ...(topicId ? { topicId } : {}),
    ...(targetWordsParam ? { targetWords: Number(targetWordsParam) } : {}),
    ...(intensityParam ? { intensity: Number(intensityParam) } : {}),
    ...(classificationBefore ? { classificationBefore } : {}),
    ...(classificationAfter ? { classificationAfter } : {}),
  }

  const report = await getA2H01Report(db(), params.runId, filters)
  return NextResponse.json(report)
}

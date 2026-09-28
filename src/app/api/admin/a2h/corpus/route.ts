import { NextRequest, NextResponse } from 'next/server'
import { requireA2HAdmin } from '@/lib/require-a2h-admin'
import { isAuthFailure } from '@/lib/require-auth'
import { db } from '@/lib/firestore'
import { listSources } from '@/lib/a2h/corpus'
import { DEFAULT_CORPUS_VERSION } from '@/lib/a2h/types'
import { DOMAINS, type Domain } from '@/lib/style/types'

export async function GET(req: NextRequest) {
  const auth = await requireA2HAdmin(req)
  if (isAuthFailure(auth)) return auth

  const corpusVersion = req.nextUrl.searchParams.get('corpusVersion') ?? DEFAULT_CORPUS_VERSION
  const domainParam = req.nextUrl.searchParams.get('domainId')
  const domainId = domainParam && (DOMAINS as readonly string[]).includes(domainParam) ? (domainParam as Domain) : undefined

  const sources = await listSources(db(), corpusVersion, domainId)
  return NextResponse.json({ sources })
}

import { NextRequest, NextResponse } from 'next/server'
import { requireA2HAdmin } from '@/lib/require-a2h-admin'
import { isAuthFailure } from '@/lib/require-auth'
import { db } from '@/lib/firestore'
import { getUserApiConfig } from '@/lib/userApiConfig'
import { getSource, listSources } from '@/lib/a2h/corpus'
import { acquireBaseline, listBaselines } from '@/lib/a2h/baseline'
import { DEFAULT_CORPUS_VERSION } from '@/lib/a2h/types'
import { DOMAINS, type Domain } from '@/lib/style/types'

// One GPTZero call per frozen source, driven interactively by the admin —
// same posture as corpus generation: this wires the call and persistence,
// the admin decides which frozen sources to baseline and when.
export const maxDuration = 60

interface BaselineBody {
  topicId?: string
  targetWords?: number
  corpusVersion?: string
  force?: boolean
}

export async function GET(req: NextRequest) {
  const auth = await requireA2HAdmin(req)
  if (isAuthFailure(auth)) return auth

  const corpusVersion = req.nextUrl.searchParams.get('corpusVersion') ?? DEFAULT_CORPUS_VERSION
  const domainParam = req.nextUrl.searchParams.get('domainId')
  const domainId = domainParam && (DOMAINS as readonly string[]).includes(domainParam) ? (domainParam as Domain) : undefined

  const sources = await listSources(db(), corpusVersion, domainId)
  const baselines = await listBaselines(db(), sources.map(s => s.id))
  return NextResponse.json({ baselines })
}

export async function POST(req: NextRequest) {
  const auth = await requireA2HAdmin(req)
  if (isAuthFailure(auth)) return auth

  let body: BaselineBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } }, { status: 400 })
  }

  if (!body.topicId || !body.targetWords) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'topicId and targetWords are required.' } }, { status: 400 })
  }

  const source = await getSource(db(), body.corpusVersion ?? DEFAULT_CORPUS_VERSION, body.topicId, body.targetWords)
  if (!source) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'No source exists for this cell.' } }, { status: 404 })
  }

  // The admin's own configured GPTZero key (Settings → AI Model), the same
  // way Humanize's post-transform scan resolves one — never a server-side
  // key for this tool.
  const userConfig = await getUserApiConfig(auth.claims.sub)
  const apiKey = userConfig?.gptzeroApiKey
  if (!apiKey) {
    return NextResponse.json(
      { error: { code: 'NO_DETECTOR_CONFIGURED', message: 'Configure a GPTZero API key (Settings) before acquiring baselines.' } },
      { status: 422 },
    )
  }

  try {
    const baseline = await acquireBaseline(db(), source, apiKey, Boolean(body.force))
    return NextResponse.json({ baseline })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Baseline acquisition failed.'
    const conflict = message.includes('already') || message.includes('frozen')
    return NextResponse.json(
      { error: { code: conflict ? 'CONFLICT' : 'BASELINE_FAILED', message } },
      { status: conflict ? 409 : 502 },
    )
  }
}

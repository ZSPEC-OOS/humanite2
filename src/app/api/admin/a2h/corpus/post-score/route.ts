import { NextRequest, NextResponse } from 'next/server'
import { requireA2HAdmin } from '@/lib/require-a2h-admin'
import { isAuthFailure } from '@/lib/require-auth'
import { db } from '@/lib/firestore'
import { getUserApiConfig } from '@/lib/userApiConfig'
import { getSource } from '@/lib/a2h/corpus'
import { getOutput, listOutputsForSource } from '@/lib/a2h/outputs'
import { acquirePostScore, listPostScores } from '@/lib/a2h/baseline'
import { DEFAULT_CORPUS_VERSION } from '@/lib/a2h/types'

export const maxDuration = 60

interface PostScoreBody {
  topicId?: string
  targetWords?: number
  intensity?: number
  corpusVersion?: string
  force?: boolean
}

export async function GET(req: NextRequest) {
  const auth = await requireA2HAdmin(req)
  if (isAuthFailure(auth)) return auth

  const topicId = req.nextUrl.searchParams.get('topicId')
  const targetWords = Number(req.nextUrl.searchParams.get('targetWords'))
  if (!topicId || !targetWords) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'topicId and targetWords are required.' } }, { status: 400 })
  }
  const corpusVersion = req.nextUrl.searchParams.get('corpusVersion') ?? DEFAULT_CORPUS_VERSION

  const source = await getSource(db(), corpusVersion, topicId, targetWords)
  if (!source) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'No source exists for this cell.' } }, { status: 404 })
  }

  const outputs = await listOutputsForSource(db(), source.id)
  const postScores = await listPostScores(db(), outputs.map(o => o.id))
  return NextResponse.json({ postScores })
}

export async function POST(req: NextRequest) {
  const auth = await requireA2HAdmin(req)
  if (isAuthFailure(auth)) return auth

  let body: PostScoreBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } }, { status: 400 })
  }

  const { topicId, targetWords, intensity } = body
  if (!topicId || !targetWords || !intensity) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'topicId, targetWords, and intensity are required.' } }, { status: 400 })
  }

  const corpusVersion = body.corpusVersion ?? DEFAULT_CORPUS_VERSION
  const source = await getSource(db(), corpusVersion, topicId, targetWords)
  if (!source) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'No source exists for this cell.' } }, { status: 404 })
  }
  const output = await getOutput(db(), source.id, intensity)
  if (!output) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'No output exists for this source/intensity.' } }, { status: 404 })
  }

  const userConfig = await getUserApiConfig(auth.claims.sub)
  const apiKey = userConfig?.gptzeroApiKey
  if (!apiKey) {
    return NextResponse.json(
      { error: { code: 'NO_DETECTOR_CONFIGURED', message: 'Configure a GPTZero API key (Settings) before acquiring post-scores.' } },
      { status: 422 },
    )
  }

  try {
    const postScore = await acquirePostScore(db(), output, apiKey, Boolean(body.force))
    return NextResponse.json({ postScore })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Post-score acquisition failed.'
    const conflict = message.includes('already exists') || message.includes('failed transformation')
    return NextResponse.json(
      { error: { code: conflict ? 'CONFLICT' : 'POST_SCORE_FAILED', message } },
      { status: conflict ? 409 : 502 },
    )
  }
}

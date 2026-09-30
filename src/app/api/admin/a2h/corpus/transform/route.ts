import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { requireA2HAdmin } from '@/lib/require-a2h-admin'
import { isAuthFailure } from '@/lib/require-auth'
import { db } from '@/lib/firestore'
import { getUserApiConfig } from '@/lib/userApiConfig'
import { resolveProvider } from '@/lib/providerResolution'
import { getSource } from '@/lib/a2h/corpus'
import { transformSource, listOutputsForSource } from '@/lib/a2h/outputs'
import { DEFAULT_CORPUS_VERSION } from '@/lib/a2h/types'

// One Humanize pipeline run per request, driven interactively by the admin
// (one intensity at a time) — same posture as corpus generation and
// baseline acquisition. Sized generously since the real pipeline (retries,
// candidate search, document-context/consistency calls) is slower than a
// single completion.
export const maxDuration = 180

interface TransformBody {
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
  return NextResponse.json({ outputs })
}

export async function POST(req: NextRequest) {
  const auth = await requireA2HAdmin(req)
  if (isAuthFailure(auth)) return auth

  let body: TransformBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } }, { status: 400 })
  }

  const { topicId, targetWords, intensity } = body
  if (!topicId || !targetWords || !intensity) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'topicId, targetWords, and intensity are required.' } }, { status: 400 })
  }
  if (!Number.isInteger(intensity) || intensity < 1 || intensity > 10) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'intensity must be an integer between 1 and 10.' } }, { status: 400 })
  }

  const source = await getSource(db(), body.corpusVersion ?? DEFAULT_CORPUS_VERSION, topicId, targetWords)
  if (!source) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'No source exists for this cell.' } }, { status: 404 })
  }

  const userConfig = await getUserApiConfig(auth.claims.sub)
  const { apiKey, baseURL, model } = resolveProvider(userConfig)
  if (!apiKey) {
    return NextResponse.json(
      { error: { code: 'NO_MODEL_CONFIGURED', message: 'Configure an AI model (Settings) before running a transformation.' } },
      { status: 422 },
    )
  }
  const client = new OpenAI({ apiKey, baseURL })

  try {
    const output = await transformSource(db(), { source, intensity, client, model }, Boolean(body.force))
    return NextResponse.json({ output })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Transformation failed.'
    const conflict = message.includes('already exists') || message.includes('only a frozen source')
    return NextResponse.json(
      { error: { code: conflict ? 'CONFLICT' : 'TRANSFORM_FAILED', message } },
      { status: conflict ? 409 : 502 },
    )
  }
}

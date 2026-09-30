import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { requireA2HAdmin } from '@/lib/require-a2h-admin'
import { isAuthFailure } from '@/lib/require-auth'
import { db } from '@/lib/firestore'
import { getUserApiConfig } from '@/lib/userApiConfig'
import { resolveProvider } from '@/lib/providerResolution'
import { getTopic } from '@/lib/a2h/topics'
import { generateSource } from '@/lib/a2h/corpus'
import { getLengthLadderConfig } from '@/lib/a2h/lengthLadder'
import { DEFAULT_CORPUS_VERSION } from '@/lib/a2h/types'

// Generation is one model call per cell, driven interactively by the admin
// (not a batch job this route kicks off) — see the corpus matrix UI, which
// calls this once per cell the admin clicks "Generate" on. 120s covers a
// slow model at the 2,000-word top of the length ladder with room to spare.
export const maxDuration = 120

interface GenerateBody {
  topicId?: string
  targetWords?: number
  corpusVersion?: string
  temperature?: number | null
  force?: boolean
}

export async function POST(req: NextRequest) {
  const auth = await requireA2HAdmin(req)
  if (isAuthFailure(auth)) return auth

  let body: GenerateBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } }, { status: 400 })
  }

  const { topicId, targetWords } = body
  if (!topicId || typeof topicId !== 'string') {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'topicId is required.' } }, { status: 400 })
  }

  // The length ladder must be locked before any source is generated against
  // it — same "settle the dimension first" rule topic counts already
  // follow — so targetWords is validated against the actual locked ladder,
  // never a hardcoded default.
  const ladderConfig = await getLengthLadderConfig(db())
  if (!ladderConfig || !ladderConfig.locked) {
    return NextResponse.json(
      { error: { code: 'LADDER_NOT_LOCKED', message: 'Lock a length ladder (Corpus Design) before generating corpus documents.' } },
      { status: 409 },
    )
  }
  if (!targetWords || !ladderConfig.ladder.includes(targetWords)) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: `targetWords must be one of: ${ladderConfig.ladder.join(', ')}` } },
      { status: 400 },
    )
  }

  const topic = await getTopic(db(), topicId)
  if (!topic) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Topic not found.' } }, { status: 404 })
  }
  if (!topic.enabled) {
    return NextResponse.json({ error: { code: 'TOPIC_DISABLED', message: 'This topic is disabled.' } }, { status: 409 })
  }

  // The admin's own configured model (Settings → AI Model), exactly the way
  // Humanize resolves it — never a separate server-side key for this tool.
  const userConfig = await getUserApiConfig(auth.claims.sub)
  const { apiKey, baseURL, model, usingByok } = resolveProvider(userConfig)
  if (!apiKey) {
    return NextResponse.json(
      { error: { code: 'NO_MODEL_CONFIGURED', message: 'Configure an AI model (Settings) before generating corpus documents.' } },
      { status: 422 },
    )
  }
  const client = new OpenAI({ apiKey, baseURL })

  try {
    const source = await generateSource(
      db(),
      {
        corpusVersion: body.corpusVersion ?? DEFAULT_CORPUS_VERSION,
        topic,
        targetWords,
        temperature: body.temperature ?? null,
        client,
        model,
        providerLabel: usingByok ? (baseURL ?? 'openai') : 'openai',
      },
      Boolean(body.force),
    )
    return NextResponse.json({ source })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Generation failed.'
    const alreadyAccepted = message.includes('already')
    return NextResponse.json(
      { error: { code: alreadyAccepted ? 'ALREADY_ACCEPTED' : 'GENERATION_FAILED', message } },
      { status: alreadyAccepted ? 409 : 502 },
    )
  }
}

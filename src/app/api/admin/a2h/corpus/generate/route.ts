import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { requireA2HAdmin } from '@/lib/require-a2h-admin'
import { isAuthFailure } from '@/lib/require-auth'
import { db } from '@/lib/firestore'
import { getUserApiConfig } from '@/lib/userApiConfig'
import { resolveProvider } from '@/lib/providerResolution'
import { getTopic } from '@/lib/a2h/topics'
import { generateSource } from '@/lib/a2h/corpus'

// Generation is one model call per cell, driven interactively by the admin
// (not a batch job this route kicks off) — see the corpus matrix UI, which
// calls this once per cell the admin clicks "Generate" on. 120s covers a
// slow model at the 2,000-word top of the length ladder with room to spare.
export const maxDuration = 120

interface GenerateBody {
  corpusProjectId?: string
  topicId?: string
  targetWords?: number
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

  const { corpusProjectId, topicId, targetWords } = body
  if (!corpusProjectId) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'corpusProjectId is required.' } }, { status: 400 })
  }
  if (!topicId || typeof topicId !== 'string') {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'topicId is required.' } }, { status: 400 })
  }
  if (!targetWords) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'targetWords is required.' } }, { status: 400 })
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
        corpusProjectId,
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
    if (message === 'Corpus project not found.') {
      return NextResponse.json({ error: { code: 'NOT_FOUND', message } }, { status: 404 })
    }
    if (message.startsWith('targetWords must be one of')) {
      return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message } }, { status: 400 })
    }
    const conflict = message.includes('already') || message.includes('Lock the blueprint') || message.includes('archived project')
    return NextResponse.json(
      { error: { code: conflict ? 'CONFLICT' : 'GENERATION_FAILED', message } },
      { status: conflict ? 409 : 502 },
    )
  }
}

import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { requireA2HAdmin } from '@/lib/require-a2h-admin'
import { isAuthFailure } from '@/lib/require-auth'
import { db } from '@/lib/firestore'
import { getUserApiConfig } from '@/lib/userApiConfig'
import { resolveProvider } from '@/lib/providerResolution'
import { generateOutline } from '@/lib/a2h/outlineGeneration'
import { DOMAINS, type Domain } from '@/lib/style/types'

// One model call generating a whole domain's roster at once, driven
// interactively by the admin clicking "Generate Outline" — same posture as
// corpus generation and baseline acquisition: this wires the call, the
// admin decides when to run it.
export const maxDuration = 60

interface GenerateOutlineBody {
  corpusProjectId?: string
  domainId?: string
  force?: boolean
}

export async function POST(req: NextRequest) {
  const auth = await requireA2HAdmin(req)
  if (isAuthFailure(auth)) return auth

  let body: GenerateOutlineBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } }, { status: 400 })
  }

  const { corpusProjectId, domainId } = body
  if (!corpusProjectId) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'corpusProjectId is required.' } }, { status: 400 })
  }
  if (!domainId || !(DOMAINS as readonly string[]).includes(domainId)) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: `domainId must be one of: ${DOMAINS.join(', ')}` } }, { status: 400 })
  }

  const userConfig = await getUserApiConfig(auth.claims.sub)
  const { apiKey, baseURL, model } = resolveProvider(userConfig)
  if (!apiKey) {
    return NextResponse.json(
      { error: { code: 'NO_MODEL_CONFIGURED', message: 'Configure an AI model (Settings) before generating an outline.' } },
      { status: 422 },
    )
  }
  const client = new OpenAI({ apiKey, baseURL })

  try {
    const topics = await generateOutline(db(), { corpusProjectId, domainId: domainId as Domain, client, model }, Boolean(body.force))
    return NextResponse.json({ topics })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Outline generation failed.'
    const conflict = message.includes('already exist') || message.includes('Set a topic count') || message.includes('project is')
    return NextResponse.json(
      { error: { code: conflict ? 'CONFLICT' : 'OUTLINE_GENERATION_FAILED', message } },
      { status: conflict ? 409 : 502 },
    )
  }
}

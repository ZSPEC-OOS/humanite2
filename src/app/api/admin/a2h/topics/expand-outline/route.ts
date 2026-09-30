import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { requireA2HAdmin } from '@/lib/require-a2h-admin'
import { isAuthFailure } from '@/lib/require-auth'
import { db } from '@/lib/firestore'
import { getUserApiConfig } from '@/lib/userApiConfig'
import { resolveProvider } from '@/lib/providerResolution'
import { expandOutline } from '@/lib/a2h/outlineGeneration'
import { DOMAINS, type Domain } from '@/lib/style/types'

// One model call generating only the additional topics needed to reach a
// domain's raised locked count — never touches the existing roster. See
// generate-outline/route.ts for the (destructive, full-replace) sibling.
export const maxDuration = 60

interface ExpandOutlineBody {
  domainId?: string
}

export async function POST(req: NextRequest) {
  const auth = await requireA2HAdmin(req)
  if (isAuthFailure(auth)) return auth

  let body: ExpandOutlineBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } }, { status: 400 })
  }

  const domainId = body.domainId
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
    const topics = await expandOutline(db(), { domainId: domainId as Domain, client, model })
    return NextResponse.json({ topics })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Outline expansion failed.'
    const conflict = message.includes('Lock a topic count') || message.includes('meets or exceeds') || message.includes('No topics exist yet')
    return NextResponse.json(
      { error: { code: conflict ? 'CONFLICT' : 'OUTLINE_GENERATION_FAILED', message } },
      { status: conflict ? 409 : 502 },
    )
  }
}

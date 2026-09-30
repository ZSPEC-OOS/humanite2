import { NextRequest, NextResponse } from 'next/server'
import { requireA2HAdmin } from '@/lib/require-a2h-admin'
import { isAuthFailure } from '@/lib/require-auth'
import { db } from '@/lib/firestore'
import { getUserApiConfig } from '@/lib/userApiConfig'
import { resolveProvider, resolvedProviderId } from '@/lib/providerResolution'
import { createRun, listRunsForProject } from '@/lib/a2h/runs'

export async function GET(req: NextRequest) {
  const auth = await requireA2HAdmin(req)
  if (isAuthFailure(auth)) return auth

  const corpusProjectId = req.nextUrl.searchParams.get('corpusProjectId')
  if (!corpusProjectId) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'corpusProjectId is required.' } }, { status: 400 })
  }
  const runs = await listRunsForProject(db(), corpusProjectId)
  return NextResponse.json({ runs })
}

interface CreateRunBody {
  corpusProjectId?: string
  name?: string
  modelProvider?: string
  model?: string
  detectorConfigId?: string
  concurrency?: number
}

export async function POST(req: NextRequest) {
  const auth = await requireA2HAdmin(req)
  if (isAuthFailure(auth)) return auth

  let body: CreateRunBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } }, { status: 400 })
  }
  if (!body.corpusProjectId) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'corpusProjectId is required.' } }, { status: 400 })
  }

  // The run snapshots the admin's own currently-configured model/provider at
  // creation time — never re-resolved later from mutable settings (§2).
  let modelProvider = body.modelProvider
  let model = body.model
  if (!modelProvider || !model) {
    const userConfig = await getUserApiConfig(auth.claims.sub)
    const resolved = resolveProvider(userConfig)
    model = model ?? resolved.model
    modelProvider = modelProvider ?? resolvedProviderId(resolved.baseURL, resolved.usingByok)
  }

  try {
    const run = await createRun(db(), {
      corpusProjectId: body.corpusProjectId,
      name: body.name ?? '',
      modelProvider,
      model,
      ...(body.detectorConfigId ? { detectorConfigId: body.detectorConfigId } : {}),
      ...(body.concurrency !== undefined ? { concurrency: body.concurrency } : {}),
    })
    return NextResponse.json({ run }, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create benchmark run.'
    const notFound = message === 'Corpus project not found.'
    const conflict = message.includes('not frozen') || message.includes('no manifest')
    return NextResponse.json(
      { error: { code: notFound ? 'NOT_FOUND' : conflict ? 'CONFLICT' : 'VALIDATION_ERROR', message } },
      { status: notFound ? 404 : conflict ? 409 : 400 },
    )
  }
}

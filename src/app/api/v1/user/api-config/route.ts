import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, isAuthFailure } from '@/lib/require-auth'
import { getApiConfig, putApiConfig } from '@/lib/r2'

// Syncs the "AI Model Config" panel — the generation model fields
// (nickname/model/base URL/API key) plus the caller's own GPTZero detection
// key — across devices via R2, keyed by the caller's identity. Best-effort
// throughout — R2 being unconfigured or unreachable degrades to
// localStorage-only behavior on the client rather than breaking anything.

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (isAuthFailure(auth)) return auth

  try {
    const config = await getApiConfig(auth.claims.sub)
    return NextResponse.json({ config })
  } catch (err) {
    console.warn('Failed to load synced API config', {
      type: err instanceof Error ? err.constructor.name : typeof err,
    })
    return NextResponse.json({ config: null })
  }
}

export async function PUT(req: NextRequest) {
  const auth = await requireAuth(req)
  if (isAuthFailure(auth)) return auth

  let body: { nickname?: string; modelId?: string; baseUrl?: string; apiKey?: string; gptzeroApiKey?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } },
      { status: 400 },
    )
  }

  try {
    await putApiConfig(auth.claims.sub, {
      nickname: body.nickname ?? '',
      modelId: body.modelId ?? '',
      baseUrl: body.baseUrl ?? '',
      apiKey: body.apiKey ?? '',
      gptzeroApiKey: body.gptzeroApiKey ?? '',
    })
    return NextResponse.json({ synced: true })
  } catch (err) {
    console.warn('Failed to sync API config', {
      type: err instanceof Error ? err.constructor.name : typeof err,
    })
    return NextResponse.json(
      { error: { code: 'SYNC_UNAVAILABLE', message: 'R2 is not configured or unreachable — saved locally only.' } },
      { status: 503 },
    )
  }
}

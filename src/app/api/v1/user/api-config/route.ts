import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, isAuthFailure } from '@/lib/require-auth'
import { getApiConfig, putApiConfig, StoredApiConfig } from '@/lib/r2'
import { isAllowedProviderBaseUrl } from '@/lib/providerAllowlist'

// Stores the "AI Model Config" panel — the generation model fields
// (nickname/model/base URL/API key) plus the caller's own GPTZero detection
// key — encrypted at rest via R2, keyed by the caller's identity. Best-effort
// throughout — R2 being unconfigured or unreachable means config isn't
// persisted (nothing to load, saves fail with 503) rather than breaking
// anything else.
//
// The raw key is write-only from the browser's perspective: GET never
// returns it, only whether one is configured and a masked hint — the
// browser is not meant to hold (or need) the real value again after saving
// it. PUT still accepts a raw key when the caller is actually setting a new
// one; an empty/omitted key field means "leave whatever's already stored
// alone", not "clear it" — clearing is the explicit `clear: true` below.

function keyHint(key: string): string {
  if (!key) return ''
  return key.length <= 4 ? '••••' : `••••${key.slice(-4)}`
}

function sanitize(config: StoredApiConfig | null) {
  return {
    nickname: config?.nickname ?? '',
    modelId: config?.modelId ?? '',
    baseUrl: config?.baseUrl ?? '',
    hasApiKey: !!config?.apiKey,
    apiKeyHint: keyHint(config?.apiKey ?? ''),
    hasGptzeroKey: !!config?.gptzeroApiKey,
    gptzeroKeyHint: keyHint(config?.gptzeroApiKey ?? ''),
  }
}

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (isAuthFailure(auth)) return auth

  try {
    const config = await getApiConfig(auth.claims.sub)
    return NextResponse.json({ config: sanitize(config) })
  } catch (err) {
    console.warn('Failed to load synced API config', {
      type: err instanceof Error ? err.constructor.name : typeof err,
    })
    return NextResponse.json({ config: sanitize(null) })
  }
}

export async function PUT(req: NextRequest) {
  const auth = await requireAuth(req)
  if (isAuthFailure(auth)) return auth

  let body: {
    nickname?: string
    modelId?: string
    baseUrl?: string
    apiKey?: string
    gptzeroApiKey?: string
    clear?: boolean
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } },
      { status: 400 },
    )
  }

  if (body.baseUrl?.trim() && !isAllowedProviderBaseUrl(body.baseUrl.trim())) {
    return NextResponse.json(
      {
        error: {
          code: 'PROVIDER_BASE_URL_NOT_ALLOWED',
          message: 'This base_url is not on the list of supported AI providers.',
        },
      },
      { status: 400 },
    )
  }

  try {
    if (body.clear) {
      await putApiConfig(auth.claims.sub, { nickname: '', modelId: '', baseUrl: '', apiKey: '', gptzeroApiKey: '' })
      return NextResponse.json({ config: sanitize(null) })
    }

    // Blank/omitted key fields keep whatever's already stored — a save that
    // only changes the nickname, say, must not wipe out an existing key.
    const existing = await getApiConfig(auth.claims.sub)
    const next: StoredApiConfig = {
      nickname: body.nickname ?? existing?.nickname ?? '',
      modelId: body.modelId ?? existing?.modelId ?? '',
      baseUrl: body.baseUrl ?? existing?.baseUrl ?? '',
      apiKey: body.apiKey?.trim() || existing?.apiKey || '',
      gptzeroApiKey: body.gptzeroApiKey?.trim() || existing?.gptzeroApiKey || '',
    }
    await putApiConfig(auth.claims.sub, next)
    return NextResponse.json({ config: sanitize(next) })
  } catch (err) {
    console.warn('Failed to sync API config', {
      type: err instanceof Error ? err.constructor.name : typeof err,
    })
    return NextResponse.json(
      { error: { code: 'SYNC_UNAVAILABLE', message: 'R2 is not configured or unreachable — config was not saved.' } },
      { status: 503 },
    )
  }
}

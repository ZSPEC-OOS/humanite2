import { jwtDecode } from 'jwt-decode'
import { useUserStore } from '@/stores/userStore'
import type { DetectionResult, DetectionSegment, LocalDiagnostics } from '@/lib/detection/contracts'
import type { PreservationByType } from '@/lib/qualityGates'

export type { DetectionResult, DetectionSegment, LocalDiagnostics, PreservationByType }

// In production this is empty string (same-origin). Set NEXT_PUBLIC_API_URL
// only when pointing this frontend at a different deployment of itself.
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? ''

export class APIError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message)
    this.name = 'APIError'
  }
}

const REFRESH_TOKEN_KEY = '__rt'

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
  skipAuth = false,
): Promise<T> {
  const token = useUserStore.getState().accessToken
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  }
  if (token && !skipAuth) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const url = path.startsWith('http') ? path : `${API_BASE}/api${path}`
  let resp = await fetch(url, { ...options, headers })

  // Access tokens are short-lived (15 min) — a 401 mid-session most likely
  // means it just expired, not that the user was never logged in. Retry
  // exactly once after a silent refresh so routine expiry doesn't interrupt
  // whatever the user was doing. skipAuth calls (login/register/refresh
  // itself) never enter this branch, so there's no retry loop.
  if (resp.status === 401 && !skipAuth && token) {
    const refreshedToken = await restoreSession()
    if (refreshedToken) {
      resp = await fetch(url, { ...options, headers: { ...headers, Authorization: `Bearer ${refreshedToken}` } })
    }
  }

  if (!resp.ok) {
    let errorBody: { error?: { code?: string; message?: string }; detail?: { code?: string; message?: string } } = {}
    try {
      errorBody = await resp.json()
    } catch {
      // ignore parse failure
    }
    const detail = errorBody.detail ?? errorBody.error
    throw new APIError(
      detail?.code ?? 'UNKNOWN_ERROR',
      detail?.message ?? `HTTP ${resp.status}`,
      resp.status,
    )
  }

  if (resp.status === 204) return undefined as T
  return resp.json()
}

export interface TokenResponse {
  access_token: string
  refresh_token: string
  token_type: string
  expires_in: number
}

interface JWTClaims {
  sub: string
  tier: string
  region: string
  scopes: string[]
}

function adoptSession(data: TokenResponse) {
  const claims = jwtDecode<JWTClaims>(data.access_token)
  useUserStore.getState().setAuth(data.access_token, claims.sub, claims.tier, claims.region, claims.scopes)
  sessionStorage.setItem(REFRESH_TOKEN_KEY, data.refresh_token)
}

// Redeems this tab's stored refresh token for a new access token, silently —
// used both by apiFetch's own 401-retry above and by a page on mount to
// restore a session an in-memory-only access token doesn't survive a reload.
// Returns the new access token, or null if there was nothing to redeem or
// the refresh token itself was invalid/expired/already used (in which case
// the stale session is cleared rather than left half-set).
export async function restoreSession(): Promise<string | null> {
  if (typeof window === 'undefined') return null
  const refreshToken = sessionStorage.getItem(REFRESH_TOKEN_KEY)
  if (!refreshToken) return null
  try {
    const data = await apiFetch<TokenResponse>(
      '/v1/auth/refresh',
      { method: 'POST', body: JSON.stringify({ refresh_token: refreshToken }) },
      true,
    )
    adoptSession(data)
    return data.access_token
  } catch {
    useUserStore.getState().clearAuth()
    sessionStorage.removeItem(REFRESH_TOKEN_KEY)
    return null
  }
}

export async function authRegister(email: string, password: string): Promise<TokenResponse> {
  const data = await apiFetch<TokenResponse>(
    '/v1/auth/register',
    { method: 'POST', body: JSON.stringify({ email, password }) },
    true,
  )
  adoptSession(data)
  return data
}

export async function authLogin(email: string, password: string): Promise<TokenResponse> {
  const data = await apiFetch<TokenResponse>(
    '/v1/auth/login',
    { method: 'POST', body: JSON.stringify({ email, password }) },
    true,
  )
  adoptSession(data)
  return data
}

// ── Humanize ──────────────────────────────────────────────────────────────────

export interface HumanizeSettings {
  intensity: number
  tone: string
  domain: string
  preserve_citations: boolean
}

export interface HumanizeOutput {
  text: string
  quality_scores: {
    // semantic_similarity/nli_entailment are null only when that specific
    // gate couldn't run (e.g. a custom model endpoint without embedding
    // support) — entity_overlap has no external dependency and is never
    // null. See `warning` for the unscored-entirely case.
    semantic_similarity: number | null
    nli_entailment: number | null
    entity_overlap: number | null
    passed: boolean | null
    failed_gate: string | null
    retry_count: number
    missing_facts: string[]
    entailment_issues: string[]
    preservation_by_type: PreservationByType
  }
  // Automatic AI-detection scan run against this output text once humanize
  // completes — null only if the scan itself failed (never blocks the
  // humanize response; see detection_warning).
  detection: DetectionResult | null
  // Set only when `detection` is null — distinguishes "not analyzed" from a
  // real "uncertain" classification, which is a populated `detection`.
  detection_warning: string | null
  watermark: {
    type: string
    fingerprint: string
    job_id: string
    model: string
    verification_url: string
    issued_at: string
  }
  postprocessor_substitutions: number
}

export interface HumanizeAPIResponse {
  job_id: string
  status: string
  output: HumanizeOutput | null
  preprocessing_metadata: {
    language: string
    word_count: number
    char_count: number
    fact_lock_count: number
    ai_signal_strength: number
  } | null
  processing_metadata: {
    model_used: string
    provider_used: string
    processing_duration_ms: number
  } | null
  result_url: string | null
  warning: string | null
}

export async function apiHumanize(
  text: string,
  settings: HumanizeSettings,
): Promise<HumanizeAPIResponse> {
  // No api_config here — the server looks up this authenticated user's own
  // saved model config (if any) itself. The browser doesn't hold the raw
  // key to send even if it wanted to; see apiConfigStore.ts.
  return apiFetch<HumanizeAPIResponse>('/v1/humanize', {
    method: 'POST',
    body: JSON.stringify({ text, settings }),
  })
}

// ── Scan ──────────────────────────────────────────────────────────────────────

export interface ScanAPIResponse extends DetectionResult {
  job_id: string
  status: string
  scan_id: string | null
  result_url: string | null
  // Set by /v1/scan when it served a cached result instead of making a new
  // detection call (see src/lib/detection/dedupe.ts). Not tracked on the
  // post-humanize auto-scan path, hence optional.
  cache_hit?: boolean
}

export async function apiScan(
  text: string,
  mode: 'quick' | 'standard' = 'standard',
): Promise<ScanAPIResponse> {
  // No api_config here either — the server looks up this authenticated
  // user's own saved GPTZero key (if any) itself, the same way it does for
  // the generation model above.
  return apiFetch<ScanAPIResponse>('/v1/scan', {
    method: 'POST',
    body: JSON.stringify({ text, mode }),
  })
}

// ── Job polling ───────────────────────────────────────────────────────────────

export interface JobStatus {
  job_id: string
  job_type: string
  status: string
  created_at: string
  completed_at: string | null
  result_url: string | null
  error_code: string | null
  // Populated once a background (async) humanize job completes.
  output: HumanizeOutput | null
  processing_metadata: {
    model_used: string
    provider_used: string
    processing_duration_ms: number
    chunk_count?: number
  } | null
  // Updated after every chunk while a long document is still processing.
  progress: { chunks_completed: number; chunks_total: number } | null
  // Same shape as `output`, built from whatever chunks have completed so
  // far — set even if the job never reaches 'completed' (e.g. it ran out of
  // background processing time), so a timeout doesn't mean losing finished
  // work.
  partial_output: HumanizeOutput | null
}

export async function apiGetJob(jobId: string): Promise<JobStatus> {
  return apiFetch<JobStatus>(`/v1/jobs/${jobId}`)
}

// ── Presets ───────────────────────────────────────────────────────────────────

export interface Preset {
  id: string
  name: string
  intensity: number
  tone: string
  domain: string
  preserve_citations: boolean
  created_at: string
}

export async function apiListPresets(): Promise<Preset[]> {
  return apiFetch<Preset[]>('/v1/user/presets')
}

export async function apiCreatePreset(
  data: Omit<Preset, 'id' | 'created_at'>,
): Promise<Preset> {
  return apiFetch<Preset>('/v1/user/presets', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function apiDeletePreset(presetId: string): Promise<void> {
  return apiFetch<void>(`/v1/user/presets/${presetId}`, { method: 'DELETE' })
}

// ── Export ────────────────────────────────────────────────────────────────────

export async function apiExport(
  text: string,
  format: 'text' | 'markdown' | 'docx',
  watermark: Record<string, string>,
  jobId: string,
  title = 'Humanite Export',
): Promise<Blob> {
  const token = useUserStore.getState().accessToken
  const resp = await fetch(`${API_BASE}/api/v1/export`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ text, format, watermark, job_id: jobId, title }),
  })

  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}))
    throw new Error(data.error?.message ?? `Export failed: HTTP ${resp.status}`)
  }
  return resp.blob()
}

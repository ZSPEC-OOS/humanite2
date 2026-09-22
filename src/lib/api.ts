import { useUserStore } from '@/stores/userStore'
import { useApiConfigStore } from '@/stores/apiConfigStore'

// In production this is empty string (same-origin). Set NEXT_PUBLIC_API_URL only
// when pointing at an external backend (legacy microservices deployment).
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
  const resp = await fetch(url, { ...options, headers })

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

export async function authRegister(email: string, password: string): Promise<TokenResponse> {
  return apiFetch<TokenResponse>(
    '/v1/auth/register',
    { method: 'POST', body: JSON.stringify({ email, password }) },
    true,
  )
}

export async function authLogin(email: string, password: string): Promise<TokenResponse> {
  return apiFetch<TokenResponse>(
    '/v1/auth/login',
    { method: 'POST', body: JSON.stringify({ email, password }) },
    true,
  )
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
    // null only if the gates couldn't run at all against a custom model
    // endpoint (see `warning`) — otherwise these are real, measured scores.
    bertscore_f1: number | null
    nli_entailment: number | null
    entity_overlap: number | null
    passed: boolean | null
    failed_gate: string | null
    retry_count: number
    missing_facts: string[]
    entailment_issues: string[]
  }
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
  const { config, hasCustomConfig } = useApiConfigStore.getState()
  const body: Record<string, unknown> = { text, settings }
  if (hasCustomConfig()) {
    body.api_config = {
      api_key: config.apiKey,
      model_id: config.modelId,
      ...(config.baseUrl.trim() ? { base_url: config.baseUrl.trim() } : {}),
    }
  }
  return apiFetch<HumanizeAPIResponse>('/v1/humanize', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

// ── Scan ──────────────────────────────────────────────────────────────────────

export interface FeatureContribution {
  feature: string
  observed_value: number
  direction: 'ai_indicator' | 'human_indicator'
  contribution: number
}

export interface ScanAPIResponse {
  job_id: string
  status: string
  scan_id: string | null
  classification: 'human-written' | 'ai-generated' | 'mixed' | 'uncertain' | null
  confidence: number | null
  human_probability: number | null
  ai_probability: number | null
  uncertain_probability: number | null
  per_sentence_perplexity: number[]
  top_features: FeatureContribution[]
  explanation: { summary: string; detail: string } | null
  model_used: string | null
  processing_duration_ms: number | null
  result_url: string | null
  warning: string | null
}

export async function apiScan(
  text: string,
  mode: 'quick' | 'standard' = 'standard',
): Promise<ScanAPIResponse> {
  const { config, hasCustomConfig } = useApiConfigStore.getState()
  const body: Record<string, unknown> = { text, mode }
  if (hasCustomConfig()) {
    body.api_config = {
      api_key: config.apiKey,
      model_id: config.modelId,
      ...(config.baseUrl.trim() ? { base_url: config.baseUrl.trim() } : {}),
    }
  }
  return apiFetch<ScanAPIResponse>('/v1/scan', {
    method: 'POST',
    body: JSON.stringify(body),
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

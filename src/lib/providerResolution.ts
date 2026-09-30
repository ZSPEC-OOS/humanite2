import { isAllowedProviderBaseUrl } from '@/lib/providerAllowlist'
import type { StoredApiConfig } from '@/lib/r2'

export interface ResolvedProvider {
  apiKey: string | undefined
  baseURL: string | undefined
  model: string
  usingByok: boolean
}

// A stored base_url is re-validated here (not just at save time in
// /v1/user/api-config) rather than trusted blindly — cheap, and covers any
// data written before that check existed or by another path. Falls back to
// undefined instead of failing the whole request: this is the caller's own
// previously-saved data, not a malicious per-request payload, so a bad
// stored value is treated as "ignore it", not "reject the job".
function safeBaseUrl(userConfig: StoredApiConfig | null): string | undefined {
  const url = userConfig?.baseUrl?.trim()
  return url && isAllowedProviderBaseUrl(url) ? url : undefined
}

// apiKey/baseURL/model must come from the SAME trust domain together, never
// defaulted independently per field. A caller can save a baseUrl and modelId
// (e.g. openrouter.ai + a premium model) without ever saving an apiKey — a
// per-field fallback would then send THIS DEPLOYMENT'S OWN OPENAI_API_KEY to
// that third-party endpoint, and let an arbitrary allowlisted model run up
// this deployment's bill with no key of the caller's own paying for it. The
// caller's own config is only ever honored as a complete set, gated on
// actually having their own key — never mixed with the server's defaults.
// The canonical OpenAI endpoint, normalized the same way a caller-saved
// baseUrl is (trimmed, no trailing slash, case-insensitive) — anything that
// resolves to this is identity 'openai' regardless of whether it came from
// this deployment's own OPENAI_BASE_URL default or was left unset entirely.
const OPENAI_DEFAULT_BASE_URLS = new Set(['https://api.openai.com/v1', 'https://api.openai.com'])

// One stable, normalized provider identity — used everywhere a run/output/
// trial needs to record (and later compare) "which provider actually served
// this," instead of each call site independently reconstructing a label
// from `usingByok ? (baseURL ?? 'openai') : 'openai'` in its own slightly
// different way. `usingByok` is accepted for context/documentation (a BYOK
// caller and this deployment's own platform key can both resolve to the
// same 'openai' identity when both ultimately hit api.openai.com) but does
// not itself change the computed identity — only the endpoint does.
export function resolvedProviderId(baseURL: string | undefined, _usingByok: boolean): string {
  const normalized = baseURL?.trim().replace(/\/+$/, '').toLowerCase()
  if (!normalized || OPENAI_DEFAULT_BASE_URLS.has(normalized)) return 'openai'
  return normalized
}

export function resolveProvider(userConfig: StoredApiConfig | null): ResolvedProvider {
  const usingByok = !!userConfig?.apiKey
  if (usingByok) {
    return {
      apiKey: userConfig!.apiKey,
      baseURL: safeBaseUrl(userConfig),
      model: userConfig!.modelId || process.env.OPENAI_MODEL || 'gpt-4o-mini',
      usingByok: true,
    }
  }
  return {
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL,
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    usingByok: false,
  }
}

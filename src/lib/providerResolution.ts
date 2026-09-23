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

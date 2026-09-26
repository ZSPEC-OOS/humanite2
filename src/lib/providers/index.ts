import type { ProviderCapabilities } from './types'
import { OPENAI_CAPABILITIES } from './openai'
import { OPENROUTER_CAPABILITIES } from './openrouter'
import { DEEPSEEK_CAPABILITIES } from './deepseek'
import { GROQ_CAPABILITIES } from './groq'
import { MISTRAL_CAPABILITIES } from './mistral'
import { ANTHROPIC_CAPABILITIES } from './anthropic'
import { GENERIC_CAPABILITIES } from './generic'

export type { ProviderCapabilities }
export { OPENAI_CAPABILITIES, OPENROUTER_CAPABILITIES, DEEPSEEK_CAPABILITIES, GROQ_CAPABILITIES, MISTRAL_CAPABILITIES, ANTHROPIC_CAPABILITIES, GENERIC_CAPABILITIES }

// Keyed by hostname, matching exactly how providerAllowlist.ts validates a
// caller-supplied base_url — the same six hosts the plan's Phase 9 spec
// names adapters for, plus the three additional allowlisted hosts
// (together.xyz, fireworks.ai, perplexity.ai) that fall back to
// GENERIC_CAPABILITIES below rather than going unhandled.
const CAPABILITIES_BY_HOST: Record<string, ProviderCapabilities> = {
  'api.openai.com': OPENAI_CAPABILITIES,
  'openrouter.ai': OPENROUTER_CAPABILITIES,
  'api.deepseek.com': DEEPSEEK_CAPABILITIES,
  'api.groq.com': GROQ_CAPABILITIES,
  'api.mistral.ai': MISTRAL_CAPABILITIES,
  'api.anthropic.com': ANTHROPIC_CAPABILITIES,
}

// `baseURL` is exactly what an OpenAI SDK client's own `.baseURL` property
// holds (undefined/missing only for a bare mock object in a test, which
// resolves the same as "no override" — full capabilities, matching that
// mock's own pre-Phase-9 behavior). A real client always has a concrete
// baseURL: the SDK itself defaults it to OpenAI's own endpoint when the
// caller never overrides it, so `undefined` in practice means "this
// deployment's own OPENAI_API_KEY/OPENAI_BASE_URL path", which — per
// providerResolution.ts — is OpenAI's endpoint unless deliberately pointed
// elsewhere.
export function resolveCapabilities(baseURL: string | undefined | null): ProviderCapabilities {
  if (!baseURL) return OPENAI_CAPABILITIES
  let hostname: string
  try {
    hostname = new URL(baseURL).hostname.toLowerCase()
  } catch {
    return GENERIC_CAPABILITIES
  }
  return CAPABILITIES_BY_HOST[hostname] ?? GENERIC_CAPABILITIES
}

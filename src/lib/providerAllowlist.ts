// Validates a user-supplied api_config.base_url (the "bring your own AI
// model" override) before the server ever makes a request to it. Without
// this, a caller could point the server at an internal address — its own
// loopback/private network, a cloud metadata endpoint, another internal
// service — and have the server make that request on their behalf (SSRF).
//
// A fixed allowlist of known OpenAI-compatible provider hosts, rather than
// full general-purpose SSRF defenses (DNS-resolution checks, redirect
// validation, private-range rejection), because arbitrary self-hosted
// endpoints aren't a supported feature today — only these named providers
// are. Add a host here only for a real, publicly documented provider.
const ALLOWED_PROVIDER_HOSTS = new Set([
  'api.openai.com',
  'api.anthropic.com',
  'api.groq.com',
  'api.together.xyz',
  'openrouter.ai',
  'api.deepseek.com',
  'api.mistral.ai',
  'api.fireworks.ai',
  'api.perplexity.ai',
])

export function isAllowedProviderBaseUrl(rawUrl: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    return false
  }
  return parsed.protocol === 'https:' && ALLOWED_PROVIDER_HOSTS.has(parsed.hostname.toLowerCase())
}

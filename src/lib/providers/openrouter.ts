import type { ProviderCapabilities } from './types'

// openrouter.ai routes a single request to whichever underlying model the
// caller names — its own capability surface is only as reliable as the
// least-capable model a caller might select, so this stays conservative
// rather than assuming the best case. OpenRouter has no general embeddings
// endpoint at all (it is a chat-completions router, not a model host), and
// response_format/logprobs support is inconsistent across the many vendors
// it routes to, so both stay unclaimed rather than intermittently correct.
export const OPENROUTER_CAPABILITIES: ProviderCapabilities = {
  chat: true,
  jsonOutput: false,
  embeddings: false,
  embeddingModel: null,
  logprobs: false,
  maxOutputTokens: 4096,
}

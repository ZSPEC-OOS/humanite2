import type { ProviderCapabilities } from './types'

// api.anthropic.com's native Messages API is not OpenAI-shaped at all — no
// response_format parameter, no logprobs, no /v1/embeddings — so a client
// built for the OpenAI SDK only reaches it at all through a compatibility
// shim, and these flags describe what the underlying Anthropic API itself
// offers, not any particular shim's translation of it. Claude models
// commonly cap chat completions at 8,192 output tokens; used here as the
// conservative default rather than assuming a specific model's higher limit.
export const ANTHROPIC_CAPABILITIES: ProviderCapabilities = {
  chat: true,
  jsonOutput: false,
  embeddings: false,
  embeddingModel: null,
  logprobs: false,
  maxOutputTokens: 8192,
}

import type { ProviderCapabilities } from './types'

// api.mistral.ai — documented JSON-mode support, and its own embeddings
// endpoint (the "mistral-embed" model) under a different name than
// OpenAI's — exactly why `embeddingModel` exists as its own field rather
// than every adapter implicitly meaning "text-embedding-3-small" whenever
// `embeddings` is true. No documented logprobs support on chat completions.
export const MISTRAL_CAPABILITIES: ProviderCapabilities = {
  chat: true,
  jsonOutput: true,
  embeddings: true,
  embeddingModel: 'mistral-embed',
  logprobs: false,
  maxOutputTokens: 8192,
}

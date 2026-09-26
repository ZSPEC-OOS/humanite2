import type { ProviderCapabilities } from './types'

// Any allowlisted host without a specific adapter (api.together.xyz,
// api.fireworks.ai, api.perplexity.ai today) — a conservative default
// rather than assuming OpenAI-level feature parity just because the wire
// protocol happens to be OpenAI-shaped. Add a named adapter for one of
// these instead of relying on this indefinitely once its actual behavior
// has been verified.
export const GENERIC_CAPABILITIES: ProviderCapabilities = {
  chat: true,
  jsonOutput: false,
  embeddings: false,
  embeddingModel: null,
  logprobs: false,
  maxOutputTokens: 4096,
}

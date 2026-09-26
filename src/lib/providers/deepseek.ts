import type { ProviderCapabilities } from './types'

// api.deepseek.com — an OpenAI-compatible chat API with documented JSON-
// mode support (response_format: {type: 'json_object'}). No public
// embeddings endpoint. deepseek-chat's own documented max_tokens ceiling
// is 8,192 — separate from, and far below, its much larger CONTEXT window,
// which is the exact "clamped lower in practice" risk
// humanizePipeline.ts's maxTokensForIntensity doc comment already warned
// about before this phase gave it a real number to enforce.
export const DEEPSEEK_CAPABILITIES: ProviderCapabilities = {
  chat: true,
  jsonOutput: true,
  embeddings: false,
  embeddingModel: null,
  logprobs: true,
  maxOutputTokens: 8192,
}

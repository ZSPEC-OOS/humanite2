import type { ProviderCapabilities } from './types'

// api.openai.com — and the deployment's own default endpoint, when no
// baseURL override is configured at all, since OPENAI_BASE_URL is only
// ever set to point somewhere else deliberately. The reference
// implementation every other adapter here is a narrower special case of.
// gpt-4o-mini's own documented output ceiling is 16,384 tokens — the exact
// figure humanizePipeline.ts's MAX_TOKENS_CEILING already used before this
// phase existed, kept in sync deliberately.
export const OPENAI_CAPABILITIES: ProviderCapabilities = {
  chat: true,
  jsonOutput: true,
  embeddings: true,
  embeddingModel: 'text-embedding-3-small',
  logprobs: true,
  maxOutputTokens: 16384,
}

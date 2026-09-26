import type { ProviderCapabilities } from './types'

// api.groq.com serves open-weight chat models (Llama, Mixtral, and others)
// over an OpenAI-compatible API with documented JSON-mode and logprobs
// support. No embeddings endpoint. maxOutputTokens varies by whichever
// specific model Groq is asked to serve; 8,192 is a conservative figure
// that fits comfortably under its smaller served models without needing
// per-model detection this codebase has no way to do today.
export const GROQ_CAPABILITIES: ProviderCapabilities = {
  chat: true,
  jsonOutput: true,
  embeddings: false,
  embeddingModel: null,
  logprobs: true,
  maxOutputTokens: 8192,
}

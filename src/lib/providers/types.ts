// Phase 9: "Stop assuming every allowlisted endpoint implements the OpenAI
// API identically." Every provider in providerAllowlist.ts speaks an
// OpenAI-*shaped* wire protocol well enough to satisfy the openai SDK's
// types, but that says nothing about which optional features the endpoint
// actually implements behind it — a caller can only use `client` this
// codebase's own SDK version already accepts, but "accepts the call" and
// "the provider implements it" are different claims, and only the second
// one is what these flags describe.
export interface ProviderCapabilities {
  // Basic chat completions — true for every adapter today; kept as an
  // explicit field (rather than assumed) so a future provider that turns
  // out to be embeddings- or completion-only has somewhere to say so.
  chat: boolean
  // Structured JSON output (response_format: {type: 'json_object'} in the
  // OpenAI wire shape) — every combined-judge/claim-verification/planning
  // call in this codebase relies on this to get back parseable JSON
  // reliably, rather than trusting a bare prompt instruction alone.
  jsonOutput: boolean
  embeddings: boolean
  // The model name to request when `embeddings` is true — provider-
  // specific (OpenAI's "text-embedding-3-small" vs Mistral's
  // "mistral-embed"), never a value to guess at generically. null when
  // `embeddings` is false.
  embeddingModel: string | null
  // Per-token log-probabilities on a chat completion — reported only,
  // per the plan: "a log-probability proxy (Binoculars-style, ref. 5) is
  // used only where Phase 9 reports logprob support." No caller in this
  // codebase reads logprobs yet; this flag exists for that future gate to
  // check, not for anything Phase 9 itself consumes.
  logprobs: boolean
  // A conservative, documented ceiling for this provider's own max_tokens
  // — distinct from (and usually far below) its context window. Used to
  // cap whatever humanizePipeline.ts's intensity-driven token budget would
  // otherwise request, so a request never asks for more completion length
  // than the endpoint actually honors.
  maxOutputTokens: number
}

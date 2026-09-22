// Shared between the humanize route (server) and the dashboard (client) so
// the input textarea's cap can never drift from what the API will actually
// accept.
//
// These are sized for large-context models (e.g. deepseek-flash's ~1M-token
// window) rather than the model's own ceiling: the real bottleneck is the
// serverless function's maxDuration on the async chunked path (see
// CHUNK_MAX_CHARS in humanize/route.ts), not how much context the model can
// hold. Raising ASYNC_MAX_CHARS further requires a longer function timeout
// on the hosting plan, not just a bigger-context model.
export const SYNC_MAX_CHARS = 24_000
export const ASYNC_MAX_CHARS = 200_000

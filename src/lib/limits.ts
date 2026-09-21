// Shared between the humanize route (server) and the dashboard (client) so
// the input textarea's cap can never drift from what the API will actually
// accept.
export const SYNC_MAX_CHARS = 10_000
export const ASYNC_MAX_CHARS = 40_000

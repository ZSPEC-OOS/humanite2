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

// Why CHARACTERS, not words, gate a request's size: this check runs in
// humanize/route.ts BEFORE preprocess() is ever called — it's the free,
// instant `.length` test that decides whether to spend any compute on a
// request at all (sync vs. async routing, or outright rejection). Word
// count only exists once preprocess() has actually tokenized the text,
// which costs real CPU — using it as the FIRST gate would mean paying that
// cost on oversized/abusive input specifically to find out it should be
// rejected. Characters are also unambiguous across languages/scripts in a
// way "word" isn't (contractions, hyphenation, CJK text with no spaces).
//
// Free's own request cap below is still SPECIFIED in words (300, matching
// what's advertised on the pricing page), but is enforced as its character
// equivalent for that same reason — converted once, here, rather than
// forcing the route to preprocess() first just to measure it.
export const FREE_TIER_MAX_REQUEST_WORDS = 300
// Average English word length (~4.7 chars) plus its trailing space, rounded
// up generously — the same "5 characters = 1 word" convention word
// processors have long used for word-count estimates, nudged to 6 so a
// legitimate 300-word submission is never rejected by the character
// approximation alone.
const CHARS_PER_WORD_ESTIMATE = 6
export const FREE_TIER_MAX_REQUEST_CHARS = FREE_TIER_MAX_REQUEST_WORDS * CHARS_PER_WORD_ESTIMATE

// The per-request character ceiling actually enforced for a given tier —
// Free's is far below SYNC_MAX_CHARS (so a Free request is always
// synchronous; it never reaches ASYNC_MAX_CHARS/background processing at
// all), every other tier keeps today's shared ceiling.
export function maxRequestCharsForTier(tier: string): number {
  return tier === 'free' ? FREE_TIER_MAX_REQUEST_CHARS : ASYNC_MAX_CHARS
}

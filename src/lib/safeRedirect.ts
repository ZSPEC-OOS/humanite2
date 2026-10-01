// Validates a caller-supplied `?next=` redirect destination (e.g.
// /auth/login?next=/developer) before it's ever passed to router.push. Only
// a plain internal path is accepted — anything that could make the browser
// navigate off-site (an absolute URL, a protocol-relative "//host/..." URL,
// a backslash variant of the same trick, or a "javascript:"/other scheme)
// falls back to DEFAULT_REDIRECT instead. This is the one place that
// decides "is this a safe place to send the user after login" — every
// caller (login, register, future pages) should go through it rather than
// trusting a query param directly, which would otherwise be an open
// redirect (?next=https://malicious-site.com).
const DEFAULT_REDIRECT = '/dashboard'

export function safeNextPath(next: string | null | undefined, fallback: string = DEFAULT_REDIRECT): string {
  if (!next) return fallback

  // Must start with exactly one '/'. "//evil.com" and "/\evil.com" are both
  // browser-recognized ways to encode a protocol-relative external URL even
  // though they start with a single visible slash-like character.
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) {
    return fallback
  }

  // Defense in depth: reject anything with a scheme-like "word:" prefix
  // (e.g. a path that somehow smuggled "javascript:alert(1)" past the
  // leading-slash check above via encoding quirks in a particular consumer).
  if (/^\/[a-zA-Z][a-zA-Z0-9+.-]*:/.test(next)) return fallback

  return next
}

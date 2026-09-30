// Pure string helpers with no server-only dependencies (no Firestore, no
// OpenAI client) — safe to import from a 'use client' page as well as from
// server modules like outlineGeneration.ts and topicMutations.ts.

// Case/punctuation/whitespace-insensitive comparison key for a topic title
// — "Hypertension", "hypertension", and "Hypertension." must all collide.
// Deliberately exact-match-after-normalization only: catching paraphrased
// near-duplicates ("Type 2 Diabetes" vs "Type II Diabetes") would need
// semantic similarity (embeddings or a judge call), a bigger lift not
// justified for this check.
export function normalizeTopicTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// Counts how many normalized titles collide *within the same domain* — the
// only scope that matters for a blueprint. The same title in two different
// domains (e.g. "Contract Law Basics" in both legal and business) is a
// legitimate coincidence, not a duplicate; this must never conflate the two
// the way a single project-wide title map would.
export function countDuplicateTitlesByDomain<T extends { domainId: string; title: string }>(topics: T[]): number {
  const byDomain = new Map<string, Map<string, number>>()
  for (const t of topics) {
    const domainSeen = byDomain.get(t.domainId) ?? new Map<string, number>()
    const key = normalizeTopicTitle(t.title)
    domainSeen.set(key, (domainSeen.get(key) ?? 0) + 1)
    byDomain.set(t.domainId, domainSeen)
  }
  let duplicates = 0
  for (const domainSeen of byDomain.values()) {
    for (const count of domainSeen.values()) {
      if (count > 1) duplicates++
    }
  }
  return duplicates
}

// A cheap, purely lexical "might be the same subject" signal for the
// blueprint review's "potential overlaps" count — real semantic overlap
// detection would need embeddings or a judge call, which isn't worth the
// cost for an admin-facing sanity check. Two titles are flagged only when
// most of their significant words match, so distinct short titles that
// happen to share one common word don't false-positive.
export function titlesLikelyOverlap(a: string, b: string): boolean {
  const wordsOf = (t: string) => new Set(normalizeTopicTitle(t).split(' ').filter(w => w.length > 2))
  const wa = wordsOf(a)
  const wb = wordsOf(b)
  if (wa.size === 0 || wb.size === 0) return false
  let shared = 0
  for (const w of wa) if (wb.has(w)) shared++
  const smaller = Math.min(wa.size, wb.size)
  return shared / smaller >= 0.6
}

// Shared exact/normalized-token preservation diff — the common algorithm
// behind A2H-04 (citations) and A2H-10 (protected terms): both classify a
// fixed inventory of expected exact strings against an output text as
// preserved/missing/modified/duplicated, plus flag unexpected new tokens of
// the same kind. One implementation here keeps the two modules' behavior
// (and its test coverage) identical instead of two subtly different
// hand-rolled diffs.
//
// Algorithm (documented, not fuzzy/semantic): for each kind-group of
// fixtures, in ordinal order, match against a multiset of observed
// normalized tokens of that same kind:
//   - exact normalized match with 1 remaining occurrence -> preserved
//   - exact normalized match with >1 occurrence -> duplicated (all
//     occurrences are consumed so the extras are never double-counted as
//     unexpected)
//   - no exact match, but an unclaimed observed token of the same kind
//     remains -> modified (paired 1:1, first-available)
//   - no exact match and no unclaimed observed token remains -> missing
// Any observed token never claimed by a fixture is unexpected.

export type PreservationStatus = 'preserved' | 'missing' | 'modified' | 'duplicated'

export interface ObservedToken {
  kind: string
  normalizedText: string
  rawText: string
}

export interface MatchableFixture<F> {
  fixture: F
  kind: string
  normalizedText: string
}

export interface FixtureMatchResult<F> {
  fixture: F
  status: PreservationStatus
  observed: string[]
}

export interface MatchOutcome<F> {
  results: FixtureMatchResult<F>[]
  unexpected: ObservedToken[]
}

export function matchFixturesAgainstObservedTokens<F>(
  fixtures: MatchableFixture<F>[],
  observed: ObservedToken[],
): MatchOutcome<F> {
  // Per-kind pools so a citation fixture can never be "matched" by a token
  // of a different kind (e.g. a figure reference never satisfies a DOI
  // fixture) even if their normalized text happened to collide.
  const pools = new Map<string, ObservedToken[]>()
  for (const token of observed) {
    const list = pools.get(token.kind)
    if (list) list.push(token)
    else pools.set(token.kind, [token])
  }

  const results: FixtureMatchResult<F>[] = []
  const claimed = new Set<ObservedToken>()

  for (const mf of fixtures) {
    const pool = pools.get(mf.kind) ?? []
    const exactMatches = pool.filter(t => !claimed.has(t) && t.normalizedText === mf.normalizedText)

    if (exactMatches.length === 1) {
      claimed.add(exactMatches[0]!)
      results.push({ fixture: mf.fixture, status: 'preserved', observed: [exactMatches[0]!.rawText] })
      continue
    }
    if (exactMatches.length > 1) {
      for (const m of exactMatches) claimed.add(m)
      results.push({ fixture: mf.fixture, status: 'duplicated', observed: exactMatches.map(m => m.rawText) })
      continue
    }

    const unclaimedOfKind = pool.find(t => !claimed.has(t))
    if (unclaimedOfKind) {
      claimed.add(unclaimedOfKind)
      results.push({ fixture: mf.fixture, status: 'modified', observed: [unclaimedOfKind.rawText] })
    } else {
      results.push({ fixture: mf.fixture, status: 'missing', observed: [] })
    }
  }

  const unexpected = observed.filter(t => !claimed.has(t))
  return { results, unexpected }
}

// Shared types for the Phase 2 benchmark: a minimal measurement harness
// covering the corpus, the human reference set, and the deterministic
// adversarial fixtures. See tests/benchmark/README.md for how the pieces
// fit together and what each acceptance criterion needs from them.

// Matches the product's own domain list (src/components/editor/ControlPanel.tsx)
// rather than inventing a separate taxonomy — the benchmark measures the
// exact domains a real user can select.
export type Domain = 'general' | 'academic' | 'business' | 'technical' | 'medical' | 'legal'

export const DOMAINS: readonly Domain[] = ['general', 'academic', 'business', 'technical', 'medical', 'legal']

export interface CorpusItem {
  id: string
  domain: Domain
  // AI-generated-style source text — the exact kind of input Humanite
  // itself is built to rewrite, so authoring this is unproblematic (unlike
  // the human reference set below, this is not standing in for a ground
  // truth about human writing).
  input: string
  // Exact substrings that must survive a correct rewrite verbatim — the
  // same class of span preprocess.ts fact-locks (numbers, dates, citations,
  // names) plus any domain-specific detail worth tracking by hand.
  mandatoryFacts: string[]
  // Exact substrings that would only appear if the rewrite corrupted a
  // fact (a flipped number, an inverted claim, a swapped entity) — never
  // legitimately produced by a correct rewrite of this item.
  prohibitedChanges: string[]
  expectedProperties: {
    minWordCount: number
    maxWordCount: number
    notes?: string
  }
}

export type AdversarialCategory =
  | 'unit-quantity'
  | 'modality'
  | 'negation'
  | 'comparator'
  | 'sign'
  | 'range-endpoint'
  | 'scientific-notation'
  | 'version-number'
  | 'cross-reference'
  | 'entity-swap'

export interface AdversarialFixture {
  id: string
  category: AdversarialCategory
  description: string
  source: string
  corrupted: string
  // The exact fact(s) from `source` a correct validator must notice are
  // gone, wrong, or reassigned in `corrupted`.
  mandatoryFacts: string[]
  // Whether today's validator — preprocess.ts's regex fact-locks plus
  // qualityGates.ts's checkEntityOverlap, the only deterministic check that
  // exists before Phase 5 — is expected to catch this corruption. Verified
  // by tests/benchmark/tests/adversarialFixtures.test.ts, which runs the
  // real functions rather than asserting this flag by hand. `false` entries
  // are committed as it.fails: the plan's Phase 1 corrected-plan table
  // calls out that Phase 3-4 needed a benchmark to check acceptance
  // criteria against, and this is the Phase 5 half of that same problem —
  // a tracked, currently-failing case that Phase 5's deterministic fact
  // ledger (modality/negation/comparator extractors, per-sentence binding)
  // exists to close.
  currentlyDetected: boolean
}

export interface DetectorSample {
  provider: string
  classification: string
  ai_probability: number | null
  calibrated_ai_rate: number | null
}

export interface BenchmarkItemResult {
  id: string
  domain: Domain
  latencyMs: number
  totalTokens: number
  estimatedCostUsd: number
  retryCount: number
  entityPreservation: number | null
  semanticSimilarity: number | null
  fidelityPassed: boolean | null
  missingFacts: string[]
  prohibitedChangesFound: string[]
  detectors: DetectorSample[]
  error?: string
}

export interface BenchmarkReport {
  generatedAt: string
  model: string
  itemCount: number
  results: BenchmarkItemResult[]
  summary: {
    meanEntityPreservation: number | null
    meanSemanticSimilarity: number | null
    fidelityPassRate: number | null
    retryRate: number
    meanLatencyMs: number
    totalTokens: number
    totalEstimatedCostUsd: number
    // Per detector id — see calibrateDetector in runBenchmark.ts. Null when
    // fewer than MIN_REFERENCE_PASSAGES_FOR_CALIBRATION human-written
    // reference passages are available for that domain: never a fabricated
    // fixed-FPR number derived from too little (or placeholder) data.
    detectorAiRateAtFixedFpr: Record<string, number | null>
    prohibitedChangeViolations: number
  }
}

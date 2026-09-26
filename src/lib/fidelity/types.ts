// Phase 5's deterministic fact ledger. Each extractor finds instances of
// one fact type within a single sentence and returns them with structured,
// comparable `data` — the validator (validator.ts) re-runs the same
// extractor on whichever output sentence aligns to the source sentence a
// fact came from, and requires an exact (deep-equal) match, rather than
// checking presence anywhere in the whole output (see validator.ts).

export type FidelityFactType =
  | 'quantity'
  | 'range'
  | 'scientific_notation'
  | 'modality'
  | 'negation'
  | 'version'
  | 'cross_reference'
  | 'entity_pair'
  | 'citation'
  | 'date'
  | 'equation'
  | 'chemical'

export interface FidelityFact {
  type: FidelityFactType
  // Index into splitSentences(sourceText) — which source sentence this
  // fact was extracted from.
  sentenceIndex: number
  // The exact matched span, for human-readable failure messages only —
  // never compared directly (data is).
  text: string
  // Structured, type-specific fields compared via deep equality. Every
  // extractor must build this with the same fixed key order across calls
  // (the validator's equality check is a JSON.stringify comparison, which
  // is key-order sensitive) — see each extractor for its exact shape.
  data: Record<string, unknown>
}

export type FidelityExtractor = (sentence: string, sentenceIndex: number) => FidelityFact[]

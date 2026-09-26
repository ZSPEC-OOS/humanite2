import type { Audience, Genre } from '@/lib/style'

// Phase 10: "make long documents consistent" — every chunk of a multi-
// chunk document is generated from its OWN text alone (chunk.ts splits the
// source before any chunk ever sees another chunk's content), so nothing
// stops chunk 3 from independently choosing a different, equally valid
// synonym for a term chunk 1 already settled on. DocumentContext is built
// ONCE from the whole source, before any chunk is generated, and shared by
// every chunk's prompt — the canonical choices it carries are what keeps
// the assembled document internally consistent.
export interface DocumentContext {
  genre: Genre | null
  audience: Audience | null
  // variant phrase -> the ONE canonical rendering every chunk must use for
  // it — built from terms the SOURCE itself renders more than one way
  // (e.g. "the Company" / "the Corporation" for the same entity). Only
  // terms with a genuine variant in the source are included; a term the
  // source already renders consistently needs no entry.
  terminology: Record<string, string>
  // abbreviation -> its full expansion, as the source itself defines it
  // (e.g. "API" -> "Application Programming Interface") — every chunk
  // must expand it the same way on first use and never introduce a
  // conflicting expansion later.
  abbreviations: Record<string, string>
  // One line per source paragraph/section, giving a later chunk's prompt
  // context about material an earlier chunk already covered, without
  // pasting the whole document into every chunk's prompt.
  sectionSummaries: string[]
}

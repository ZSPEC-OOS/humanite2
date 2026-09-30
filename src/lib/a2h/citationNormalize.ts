// Deterministic citation normalization (§10) — pure string transforms only,
// no semantic interpretation. Every rule here is intentionally narrow and
// documented: normalization closes whitespace/prefix/leading-zero
// differences that are obviously cosmetic, and NEVER changes a citation's
// actual identifying number, so `[4-7]` never normalizes toward `[4-8]` and
// `Figure 3` never normalizes toward `Figure 4`.
export type CitationKind = 'numeric' | 'numeric_range' | 'author_year' | 'doi' | 'figure' | 'table' | 'section'

const DOI_PREFIXES = ['https://doi.org/', 'http://doi.org/', 'https://dx.doi.org/', 'http://dx.doi.org/', 'doi:']

function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

// Strips leading zeros from each dot-separated numeric segment of a
// figure/table/section label, e.g. "Figure 03" -> "Figure 3" and
// "Section 04.01" -> "Section 4.1" — documented as the one numeric
// normalization this module performs, since it only removes a
// non-significant leading zero and never changes the number's value.
function normalizeNumberSegments(numberPart: string): string {
  return numberPart.split('.').map(seg => String(Number(seg))).join('.')
}

export function normalizeCitation(kind: CitationKind, exactText: string): string {
  const collapsed = collapseWhitespace(exactText)
  switch (kind) {
    case 'numeric':
    case 'numeric_range': {
      // "[ 1 ]" -> "[1]", "[ 4 - 7 ]" -> "[4-7]" — whitespace only; the
      // digits/dash themselves are never touched.
      return collapsed.replace(/\[\s*/, '[').replace(/\s*\]/, ']').replace(/\s*-\s*/, '-')
    }
    case 'author_year':
      return collapsed
    case 'doi': {
      let d = collapsed
      for (const prefix of DOI_PREFIXES) {
        if (d.toLowerCase().startsWith(prefix)) {
          d = d.slice(prefix.length)
          break
        }
      }
      // DOIs are registered case-insensitively (DOI Handbook §2) —
      // lowercasing here is a documented equivalence rule, not a silent
      // "looks similar" heuristic.
      return d.trim().toLowerCase()
    }
    case 'figure':
    case 'table':
    case 'section': {
      const m = /^(Fig(?:ure)?|Table|Section)\.?\s*(\d+(?:\.\d+)*)$/i.exec(collapsed)
      if (!m) return collapsed
      const label = kind === 'figure' ? 'Figure' : kind === 'table' ? 'Table' : 'Section'
      return `${label} ${normalizeNumberSegments(m[2]!)}`
    }
    default:
      return collapsed
  }
}

export interface CitationToken {
  kind: CitationKind
  rawText: string
  normalizedText: string
}

const BRACKET_CITATION_RE = /\[\s*\d+(?:\s*-\s*\d+)?\s*\]/g
const AUTHOR_YEAR_PAREN_RE = /\([A-Z][A-Za-z'-]+(?:\s+(?:&|and)\s+[A-Z][A-Za-z'-]+)?,\s*\d{4}[a-z]?\)/g
const AUTHOR_YEAR_ETAL_RE = /[A-Z][A-Za-z'-]+\s+et al\.\s*\(\d{4}[a-z]?\)/g
const DOI_RE = /(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)?10\.\d{4,9}\/[^\s,;)"'<>]+/gi
const FIGURE_RE = /\bFig(?:ure)?\.?\s*\d+\b/gi
const TABLE_RE = /\bTable\s*\d+\b/gi
const SECTION_RE = /\bSection\s*\d+(?:\.\d+)*\b/gi

// Scans arbitrary text (a frozen source or a Humanite output) for every
// citation-like token this module knows how to recognize — used both by the
// A2H-04 evaluator (against output text) and by fixture-candidate scanning
// (against source text, see fixtures.ts). Deliberately conservative: a
// token pattern this doesn't recognize is simply never extracted, never
// guessed at.
export function extractCitationTokens(text: string): CitationToken[] {
  const tokens: CitationToken[] = []
  const push = (kind: CitationKind, rawText: string) => tokens.push({ kind, rawText, normalizedText: normalizeCitation(kind, rawText) })

  for (const m of text.matchAll(BRACKET_CITATION_RE)) push(m[0]!.includes('-') ? 'numeric_range' : 'numeric', m[0]!)
  for (const m of text.matchAll(AUTHOR_YEAR_PAREN_RE)) push('author_year', m[0]!)
  for (const m of text.matchAll(AUTHOR_YEAR_ETAL_RE)) push('author_year', m[0]!)
  for (const m of text.matchAll(DOI_RE)) push('doi', m[0]!)
  for (const m of text.matchAll(FIGURE_RE)) push('figure', m[0]!)
  for (const m of text.matchAll(TABLE_RE)) push('table', m[0]!)
  for (const m of text.matchAll(SECTION_RE)) push('section', m[0]!)
  return tokens
}

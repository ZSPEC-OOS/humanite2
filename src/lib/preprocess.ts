export type FactLockType =
  | 'number'
  | 'citation'
  | 'date'
  | 'quotation'
  | 'url'
  | 'equation'
  | 'chemical'
  | 'proper_noun'

export type FactLock = {
  char_start: number
  char_end: number
  text: string
  lock_type: FactLockType
  label: string
}

export type PreprocessResult = {
  sanitized_text: string
  fact_locks: FactLock[]
  word_count: number
  char_count: number
  language: string
}

// Matches numbers with an optional unit suffix. Deliberately excludes a few
// unit abbreviations that collide with common English words immediately
// after a number ("in" for inches, "bar", "gal") — a missed unit costs
// nothing (the bare number is still locked), while a false match there
// would misfire constantly on ordinary prose ("5 in the morning").
const NUMBER_RE =
  /\b\d{1,3}(?:,\d{3})*(?:\.\d+)?(?:\s*(?:%|°[CF]|km|m|cm|kg|g|mg|lb|ml|l|L|USD|EUR|GBP|mph|kph|Hz|MHz|GHz|TB|GB|MB|KB|ft|yd|mi|oz|qt|pt|rpm|bpm|kW|MW|kV|mA|mol|kcal|kPa|kJ|psi|dB|nm|min|hr))?\b/g

// Citation patterns: [1], (Smith, 2024), et al. (2024)
const CITATION_RE =
  /(?:\[\d+(?:,\s*\d+)*\]|\(\w[\w\s,.]+,\s*\d{4}\)|et\s+al\.\s*(?:\(\d{4}\)|\[\d+\]))/g

// ISO dates and common written-out date formats
const DATE_RE =
  /\b(?:\d{4}-\d{2}-\d{2}|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+\d{4})\b/g

// Straight- and curly-quoted passages. Double quotes only — single quotes
// are far too common as apostrophes/contractions to use as a delimiter
// without a real tokenizer.
const QUOTATION_RE = /"[^"\n]{1,300}"|“[^”\n]{1,300}”/g

const URL_RE = /\bhttps?:\/\/[^\s<>"')\]]+|\bwww\.[^\s<>"')\]]+/g

// LaTeX-delimited math only ($...$, \(...\), \[...\]) — unambiguous where
// present, unlike trying to freeform-detect bare math expressions in prose.
const EQUATION_RE = /\$[^$\n]{1,200}\$|\\\([^)\n]{1,200}\\\)|\\\[[^\]\n]{1,200}\\\]/g

// Formula-shaped tokens: runs of (uppercase letter + optional lowercase
// letter + optional digits), e.g. H2O, NaCl, C6H12O6. This also matches
// some all-caps acronyms (USA, NASA) as a side effect — locking those is
// harmless (they wouldn't be rephrased anyway) even though the CHEM label
// is technically wrong for them, so no acronym exclusion list is worth the
// added complexity here.
const CHEMICAL_RE = /\b(?:[A-Z][a-z]?\d*){2,}\b/g

// Two-to-five-word Title Case runs — full proper names ("New York City",
// "World Health Organization") rather than single capitalized words, which
// are too ambiguous (sentence-initial capitalization of an ordinary word)
// to lock without a real NER model. Excludes a short list of common
// capitalized sentence-openers so "The United Nations…" locks "United
// Nations" rather than "The United".
const PROPER_NOUN_RE =
  /\b(?!(?:The|A|An|This|That|These|Those|It|In|On|At|As|But|And|So|However|If|When|While|There|Here)\s)[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,4}\b/g

// Zero-width and invisible chars
const ZERO_WIDTH_RE = /[​‌‍‎‏‪-‮⁠-⁤﻿­]/g
const HTML_TAGS_RE = /<[^>]{0,500}>/g
const EXCESS_SPACES_RE = /[ \t]{3,}/g
const EXCESS_NEWLINES_RE = /\n{3,}/g

// Analyzes/rewrites text as data — it is never executed, so markup-like
// content (a document about <script> tags, an email with an onclick=
// example) is normalized, not rejected outright. The security boundary is
// downstream: never render this text as unescaped HTML, and never
// interpolate it into a privileged instruction (see lib/detection/gateway.ts,
// which sends it to the detector as a JSON field, not a prompt).
export function preprocess(text: string): PreprocessResult {
  let clean = text
  clean = clean.replace(ZERO_WIDTH_RE, '')
  clean = clean.replace(HTML_TAGS_RE, '')
  clean = clean.replace(EXCESS_SPACES_RE, ' ')
  clean = clean.replace(EXCESS_NEWLINES_RE, '\n\n')
  clean = clean.trim()

  const locks: FactLock[] = []
  const covered = new Set<string>()

  function addLock(start: number, end: number, matchText: string, type: FactLockType, label: string) {
    for (let i = start; i < end; i++) {
      if (covered.has(String(i))) return
    }
    for (let i = start; i < end; i++) covered.add(String(i))
    locks.push({ char_start: start, char_end: end, text: matchText, lock_type: type, label })
  }

  // Wider, more specific spans are locked before NUMBER_RE gets a chance to
  // claim a bare digit run inside them (e.g. the "12" in "[12]", the "1" in
  // "?q=1", the "2" in "$E=mc^2$") — the same reasoning that puts QUOTATION
  // first: preserve the whole span verbatim, not just the digits inside it
  // that happen to also look like a number. NUMBER_RE itself runs after all
  // of CITATION/URL/EQUATION for this reason; DATE_RE precedes it too, since
  // a date's own digit groups (e.g. "01"/"05" in "2024-01-05") would
  // otherwise be picked off the same way.
  for (const m of clean.matchAll(QUOTATION_RE)) {
    addLock(m.index!, m.index! + m[0].length, m[0], 'quotation', 'QUOTE')
  }
  for (const m of clean.matchAll(DATE_RE)) {
    addLock(m.index!, m.index! + m[0].length, m[0], 'date', 'DATE')
  }
  for (const m of clean.matchAll(CITATION_RE)) {
    addLock(m.index!, m.index! + m[0].length, m[0], 'citation', 'CITE')
  }
  for (const m of clean.matchAll(URL_RE)) {
    addLock(m.index!, m.index! + m[0].length, m[0], 'url', 'URL')
  }
  for (const m of clean.matchAll(EQUATION_RE)) {
    addLock(m.index!, m.index! + m[0].length, m[0], 'equation', 'EQN')
  }
  for (const m of clean.matchAll(NUMBER_RE)) {
    addLock(m.index!, m.index! + m[0].length, m[0], 'number', 'NUM')
  }
  for (const m of clean.matchAll(CHEMICAL_RE)) {
    addLock(m.index!, m.index! + m[0].length, m[0], 'chemical', 'CHEM')
  }
  for (const m of clean.matchAll(PROPER_NOUN_RE)) {
    addLock(m.index!, m.index! + m[0].length, m[0], 'proper_noun', 'NAME')
  }

  locks.sort((a, b) => a.char_start - b.char_start)

  const words = clean.split(/\s+/).filter(Boolean)

  return {
    sanitized_text: clean,
    fact_locks: locks,
    word_count: words.length,
    char_count: clean.length,
    language: 'en',
  }
}

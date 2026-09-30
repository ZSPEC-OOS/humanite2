// Deterministic numeric/unit parsing (§12) — the foundation A2H-05 is built
// on. Every parse function here is conservative: given text that doesn't
// cleanly match its kind's expected shape, it returns null rather than
// guessing, per §12's "do not claim semantic equivalence when parser
// confidence is low." Comparison for preservation is done on the PARSED
// structured value (numericValue/unit/rangeStart.../normalizedValue), never
// on raw string identity — this is what makes "5.0" and "5" compare equal
// (documented decimal-formatting equivalence, §41) while "5 mg" and "50 mg"
// do not.
export type NumericUnitKind =
  | 'integer' | 'decimal' | 'percentage' | 'currency' | 'date' | 'signed_number'
  | 'range' | 'scientific_notation' | 'value_unit' | 'version_number'

export interface ParsedNumericValue {
  numericValue: number | null
  unit: string | null
  rangeStart: number | null
  rangeEnd: number | null
  sign: '+' | '-' | null
  exponent: number | null
  normalizedValue: string
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

function signOf(text: string, value: number): '+' | '-' | null {
  if (text.trim().startsWith('+')) return '+'
  if (text.trim().startsWith('-') || value < 0) return '-'
  return null
}

function parseInteger(text: string): ParsedNumericValue | null {
  const m = /^([+-]?\d+)$/.exec(text.trim())
  if (!m) return null
  const numericValue = Number(m[1])
  return { numericValue, unit: null, rangeStart: null, rangeEnd: null, sign: signOf(text, numericValue), exponent: null, normalizedValue: String(numericValue) }
}

function parseDecimal(text: string): ParsedNumericValue | null {
  const m = /^([+-]?\d+\.\d+)$/.exec(text.trim())
  if (!m) return null
  const numericValue = Number(m[1])
  return { numericValue, unit: null, rangeStart: null, rangeEnd: null, sign: signOf(text, numericValue), exponent: null, normalizedValue: String(numericValue) }
}

function parsePercentage(text: string): ParsedNumericValue | null {
  const m = /^([+-]?\d+(?:\.\d+)?)\s*(?:%|percent)$/i.exec(text.trim())
  if (!m) return null
  const numericValue = Number(m[1])
  return { numericValue, unit: '%', rangeStart: null, rangeEnd: null, sign: signOf(text, numericValue), exponent: null, normalizedValue: `${numericValue}%` }
}

function parseCurrency(text: string): ParsedNumericValue | null {
  const m = /^([$€£¥])\s*(\d+(?:\.\d+)?)$/.exec(text.trim())
  if (!m) return null
  const numericValue = Number(m[2])
  const unit = m[1]!
  return { numericValue, unit, rangeStart: null, rangeEnd: null, sign: null, exponent: null, normalizedValue: `${unit}${numericValue}` }
}

// ISO (2024-05-17) and long-form (May 17, 2024) dates normalize to the same
// ISO string when they denote the same calendar date — a documented
// equivalence (different notation, identical information), distinct from
// the "never claim equivalence for a meaningful numeric change" rule.
function parseDate(text: string): ParsedNumericValue | null {
  const trimmed = text.trim()
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed)
  if (iso) {
    return { numericValue: null, unit: null, rangeStart: null, rangeEnd: null, sign: null, exponent: null, normalizedValue: trimmed }
  }
  const long = /^([A-Z][a-z]+)\s+(\d{1,2}),\s*(\d{4})$/.exec(trimmed)
  if (long) {
    const monthIndex = MONTH_NAMES.findIndex(m => m === long[1])
    if (monthIndex === -1) return null
    const month = String(monthIndex + 1).padStart(2, '0')
    const day = long[2]!.padStart(2, '0')
    return { numericValue: null, unit: null, rangeStart: null, rangeEnd: null, sign: null, exponent: null, normalizedValue: `${long[3]}-${month}-${day}` }
  }
  return null
}

function parseSignedNumber(text: string): ParsedNumericValue | null {
  const m = /^([+-])(\d+(?:\.\d+)?)$/.exec(text.trim())
  if (!m) return null
  const magnitude = Number(m[2])
  const sign = m[1] as '+' | '-'
  return { numericValue: sign === '-' ? -magnitude : magnitude, unit: null, rangeStart: null, rangeEnd: null, sign, exponent: null, normalizedValue: `${sign}${magnitude}` }
}

function parseRange(text: string): ParsedNumericValue | null {
  const m = /^(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)\s*([a-zA-Z/%]*)$/.exec(text.trim())
  if (!m) return null
  const rangeStart = Number(m[1])
  const rangeEnd = Number(m[2])
  const unit = m[3] ? m[3] : null
  return { numericValue: null, unit, rangeStart, rangeEnd, sign: null, exponent: null, normalizedValue: `${rangeStart}-${rangeEnd}${unit ? ` ${unit}` : ''}` }
}

function parseScientificNotation(text: string): ParsedNumericValue | null {
  const trimmed = text.trim()
  const timesForm = /^(-?\d+(?:\.\d+)?)\s*[×x]\s*10\^(-?\d+)$/i.exec(trimmed)
  const eForm = /^(-?\d+(?:\.\d+)?)[eE](-?\d+)$/.exec(trimmed)
  const m = timesForm ?? eForm
  if (!m) return null
  const numericValue = Number(m[1])
  const exponent = Number(m[2])
  return { numericValue, unit: null, rangeStart: null, rangeEnd: null, sign: signOf(text, numericValue), exponent, normalizedValue: `${numericValue}e${exponent}` }
}

function parseValueUnit(text: string): ParsedNumericValue | null {
  const m = /^(-?\d+(?:\.\d+)?)\s*([a-zA-Zµ°%]+(?:\/[a-zA-Zµ°%]+)?)$/.exec(text.trim())
  if (!m) return null
  const numericValue = Number(m[1])
  const unit = m[2]!
  return { numericValue, unit, rangeStart: null, rangeEnd: null, sign: signOf(text, numericValue), exponent: null, normalizedValue: `${numericValue} ${unit}` }
}

// The leading v/V is cosmetic (documented) — "v2.1" and "2.1" normalize
// identically; the dotted number itself is never altered.
function parseVersionNumber(text: string): ParsedNumericValue | null {
  const m = /^[vV]?(\d+(?:\.\d+){1,3})$/.exec(text.trim())
  if (!m) return null
  return { numericValue: null, unit: null, rangeStart: null, rangeEnd: null, sign: null, exponent: null, normalizedValue: m[1]! }
}

const PARSERS: Record<NumericUnitKind, (text: string) => ParsedNumericValue | null> = {
  integer: parseInteger,
  decimal: parseDecimal,
  percentage: parsePercentage,
  currency: parseCurrency,
  date: parseDate,
  signed_number: parseSignedNumber,
  range: parseRange,
  scientific_notation: parseScientificNotation,
  value_unit: parseValueUnit,
  version_number: parseVersionNumber,
}

export function parseNumericExpression(kind: NumericUnitKind, text: string): ParsedNumericValue | null {
  return PARSERS[kind](text)
}

// Broad, kind-specific candidate regexes used to scan free text (a Humanize
// output) for occurrences that might correspond to a fixture of that kind —
// intentionally permissive (a regex "shape" match), with parseNumericExpression
// re-validating every candidate before it is trusted. A candidate that fails
// to parse under its own kind is dropped rather than treated as a token
// with unknown value.
const CANDIDATE_PATTERNS: Record<NumericUnitKind, RegExp> = {
  integer: /(?<![.\d])[+-]?\d+(?!\.\d)(?!%)(?![a-zA-Zµ°])\b/g,
  decimal: /[+-]?\d+\.\d+\b(?!\s*%)/g,
  // '%' is itself a non-word character, so a trailing \b after it never
  // matches when followed by whitespace/punctuation — only the "percent"
  // spelled-out alternative needs (and gets) the boundary assertion.
  percentage: /[+-]?\d+(?:\.\d+)?\s*(?:%|percent\b)/gi,
  currency: /[$€£¥]\s*\d+(?:\.\d+)?/g,
  date: /\b\d{4}-\d{2}-\d{2}\b|\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s*\d{4}\b/g,
  signed_number: /[+-]\d+(?:\.\d+)?(?!%)\b/g,
  range: /\d+(?:\.\d+)?\s*(?:-|–|to)\s*\d+(?:\.\d+)?\s*[a-zA-Z/%]*/g,
  scientific_notation: /-?\d+(?:\.\d+)?\s*[×x]\s*10\^-?\d+|-?\d+(?:\.\d+)?[eE]-?\d+/gi,
  value_unit: /-?\d+(?:\.\d+)?\s*[a-zA-Zµ°%]+(?:\/[a-zA-Zµ°%]+)?/g,
  version_number: /\bv?\d+(?:\.\d+){1,3}\b/gi,
}

export interface NumericCandidate {
  rawText: string
  parsed: ParsedNumericValue
}

export function extractNumericCandidates(kind: NumericUnitKind, text: string): NumericCandidate[] {
  const pattern = CANDIDATE_PATTERNS[kind]
  const candidates: NumericCandidate[] = []
  for (const m of text.matchAll(pattern)) {
    const parsed = parseNumericExpression(kind, m[0]!)
    if (parsed) candidates.push({ rawText: m[0]!, parsed })
  }
  return candidates
}

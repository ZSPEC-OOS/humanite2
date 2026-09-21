export type FactLock = {
  char_start: number
  char_end: number
  text: string
  lock_type: 'number' | 'citation' | 'date'
  label: string
}

export type PreprocessResult = {
  sanitized_text: string
  fact_locks: FactLock[]
  word_count: number
  char_count: number
  language: string
}

// Matches numbers with optional units
const NUMBER_RE =
  /\b\d{1,3}(?:,\d{3})*(?:\.\d+)?(?:\s*(?:%|°[CF]|km|m|cm|kg|g|mg|lb|ml|l|L|USD|EUR|GBP|mph|kph|Hz|MHz|GHz|TB|GB|MB|KB))?\b/g

// Citation patterns: [1], (Smith, 2024), et al. (2024)
const CITATION_RE =
  /(?:\[\d+(?:,\s*\d+)*\]|\(\w[\w\s,.]+,\s*\d{4}\)|et\s+al\.\s*(?:\(\d{4}\)|\[\d+\]))/g

// ISO dates and common written-out date formats
const DATE_RE =
  /\b(?:\d{4}-\d{2}-\d{2}|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+\d{4})\b/g

// Injection detection
const INJECTION_PATTERNS = [
  /<script/i,
  /javascript\s*:/i,
  /on\w{1,20}\s*=\s*['"]/i,
  /<!--[\s\S]*?-->/,
  /<\s*iframe/i,
]

// Zero-width and invisible chars
const ZERO_WIDTH_RE = /[​‌‍‎‏‪-‮⁠-⁤﻿­]/g
const HTML_TAGS_RE = /<[^>]{0,500}>/g
const EXCESS_SPACES_RE = /[ \t]{3,}/g
const EXCESS_NEWLINES_RE = /\n{3,}/g

export function preprocess(text: string): PreprocessResult {
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(text)) {
      throw new Error('INJECTION_ATTEMPT')
    }
  }

  let clean = text
  clean = clean.replace(ZERO_WIDTH_RE, '')
  clean = clean.replace(HTML_TAGS_RE, '')
  clean = clean.replace(EXCESS_SPACES_RE, ' ')
  clean = clean.replace(EXCESS_NEWLINES_RE, '\n\n')
  clean = clean.trim()

  const locks: FactLock[] = []
  const covered = new Set<string>()

  function addLock(start: number, end: number, matchText: string, type: FactLock['lock_type'], label: string) {
    for (let i = start; i < end; i++) {
      if (covered.has(String(i))) return
    }
    for (let i = start; i < end; i++) covered.add(String(i))
    locks.push({ char_start: start, char_end: end, text: matchText, lock_type: type, label })
  }

  for (const m of clean.matchAll(DATE_RE)) {
    addLock(m.index!, m.index! + m[0].length, m[0], 'date', 'DATE')
  }
  for (const m of clean.matchAll(NUMBER_RE)) {
    addLock(m.index!, m.index! + m[0].length, m[0], 'number', 'NUM')
  }
  for (const m of clean.matchAll(CITATION_RE)) {
    addLock(m.index!, m.index! + m[0].length, m[0], 'citation', 'CITE')
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

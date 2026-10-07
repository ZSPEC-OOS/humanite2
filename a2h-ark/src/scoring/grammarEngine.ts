// Ported from humanite2 src/lib/a2h/grammarEngine.ts @ 141e366 (imports only changed).
import { createHash } from 'crypto'
import { splitSentences } from '../vendor/detection/diagnostics/tokenize'
import type { GrammarEngineConfig, GrammarFinding } from '../shared/types'

// A2H-08's damage measurement and A2H-06's repair scoring both need a fixed,
// versioned, deterministic (non-LLM) grammar detector (§13). No existing
// dependency in this repo provides one (checked: no retext/write-good/
// languagetool/nspell/compromise-style package is installed), and adding a
// full POS-tagging grammar-check library is a large, risky dependency to
// take on for a bounded, documented rule set — so this module is a small,
// explicitly-scoped rule engine instead. It is NOT a general grammar
// checker: each rule below is a narrow, documented heuristic targeting one
// of the 11 categories §6 requires "at minimum," with deliberately uneven
// coverage (subject-verb agreement, article, punctuation, run-on, and
// fragment detection are genuinely functional; the remaining categories
// have narrow, best-effort rules) — per §6, "do not require all categories
// to have the same repair strategy."
export const GRAMMAR_ENGINE_VERSION = 'GRAMMAR-V001'
const DISABLED_RULES: readonly string[] = []

function computeConfigHash(engine: string, version: string, language: string, disabledRules: readonly string[]): string {
  return createHash('sha256').update(JSON.stringify({ engine, version, language, disabledRules })).digest('hex').slice(0, 16)
}

export const GRAMMAR_ENGINE_CONFIG: GrammarEngineConfig = {
  engine: 'a2h-rule-engine',
  version: GRAMMAR_ENGINE_VERSION,
  language: 'en',
  disabledRules: [...DISABLED_RULES],
  configHash: computeConfigHash('a2h-rule-engine', GRAMMAR_ENGINE_VERSION, 'en', DISABLED_RULES),
}

// ── Subject-verb agreement (the flagship, most-tested category) ─────────

const MODALS = new Set(['can', 'could', 'will', 'would', 'shall', 'should', 'may', 'might', 'must'])
const PLURAL_PRONOUNS = new Set(['they', 'we', 'these', 'those'])
const SINGULAR_PRONOUNS = new Set(['he', 'she', 'it', 'this', 'that'])
const IRREGULAR_PLURAL_NOUNS = new Set(['bacteria', 'criteria', 'phenomena', 'media', 'data', 'people'])
const DETERMINERS_QUANTIFIERS = new Set(['a', 'an', 'the', 'this', 'that', 'these', 'those', 'some', 'many', 'few', 'several', 'each', 'every', 'no'])
const ADVERBS_TO_SKIP = new Set(['often', 'always', 'usually', 'sometimes', 'rarely', 'never', 'also', 'still', 'already', 'just', 'generally', 'typically', 'frequently'])

// Without a real POS tagger, "does this word end in -s" is not enough to
// tell a plural-form verb from an ordinary noun/adjective (e.g. "system",
// "transmission") — every base form this engine will treat as a verb
// candidate must be recognized here first. Deliberately a closed,
// extensible list rather than "any word," trading recall for zero false
// positives on ordinary nouns.
const KNOWN_VERB_BASES = new Set([
  'be', 'have', 'do', 'go', 'enter', 'produce', 'recognize', 'help', 'reduce', 'limit', 'promote', 'treat', 'prevent',
  'make', 'take', 'give', 'use', 'need', 'want', 'show', 'include', 'provide', 'cause', 'allow', 'require', 'affect',
  'increase', 'decrease', 'improve', 'support', 'develop', 'contain', 'involve', 'result', 'lead', 'occur', 'remain',
  'appear', 'exist', 'continue', 'begin', 'follow', 'present', 'indicate', 'suggest', 'demonstrate', 'confirm', 'reveal',
  'determine', 'apply', 'depend', 'vary', 'differ', 'act', 'react', 'respond', 'bind', 'block', 'inhibit', 'activate',
  'release', 'form', 'spread', 'infect', 'attack', 'protect', 'trigger', 'stimulate', 'regulate', 'control', 'target',
  'recover', 'heal', 'grow', 'move', 'live', 'die', 'break', 'rise', 'fall', 'change', 'work', 'study', 'learn', 'build',
  'understand', 'know', 'think', 'believe', 'consider', 'report', 'observe', 'measure', 'assess', 'evaluate', 'monitor',
  'diagnose', 'administer', 'prescribe', 'recommend',
])

type VerbNumber = 'singular' | 'plural' | null

// Given an observed token, determine whether it plausibly IS a verb and, if
// so, whether it's in 3rd-person-singular present form, plus its
// reconstructed base form — reversing the regular English -s/-es/-ies
// suffix rules plus the four irregulars this engine special-cases
// (be/have/do/go). Returns null for anything not recognized as a verb at
// all (see KNOWN_VERB_BASES above).
function analyzeVerbForm(word: string): { number: VerbNumber; base: string } | null {
  const lower = word.toLowerCase()
  if (lower === 'is') return { number: 'singular', base: 'be' }
  if (lower === 'are' || lower === 'were') return { number: 'plural', base: 'be' }
  if (lower === 'was') return { number: 'singular', base: 'be' }
  if (lower === 'has') return { number: 'singular', base: 'have' }
  if (lower === 'have') return { number: 'plural', base: 'have' }
  if (lower === 'does') return { number: 'singular', base: 'do' }
  if (lower === 'do') return { number: 'plural', base: 'do' }
  if (lower === 'goes') return { number: 'singular', base: 'go' }
  if (lower === 'go') return { number: 'plural', base: 'go' }

  let base: string
  let isSingularForm: boolean
  if (/[^aeiou]ies$/.test(lower)) {
    base = lower.slice(0, -3) + 'y'
    isSingularForm = true
  } else if (/(?:[sxz]|ch|sh)es$/.test(lower)) {
    base = lower.slice(0, -2)
    isSingularForm = true
  } else if (/[a-z]s$/.test(lower)) {
    base = lower.slice(0, -1)
    isSingularForm = true
  } else {
    base = lower
    isSingularForm = false
  }

  if (!KNOWN_VERB_BASES.has(base)) return null
  return { number: isSingularForm ? 'singular' : 'plural', base }
}

function thirdPersonSingularForm(base: string): string {
  const lower = base.toLowerCase()
  if (lower === 'be') return 'is'
  if (lower === 'have') return 'has'
  if (lower === 'do') return 'does'
  if (lower === 'go') return 'goes'
  if (/(?:[sxz]|ch|sh)$/.test(lower)) return base + 'es'
  if (/[^aeiou]y$/.test(lower)) return base.slice(0, -1) + 'ies'
  return base + 's'
}

// Scans backward from a verb's token index for the head noun/pronoun of its
// subject, skipping determiners/quantifiers and a small set of adverbs
// (§7's "Protozoan parasites often has..." needs "often" skipped to reach
// "parasites"). Deliberately shallow (nearest-noun only) — it does NOT
// resolve true grammatical heads across a modifying phrase (see the
// dedicated gerund-subject rule below for the one case this fixture set
// needs that for).
// A small, closed set of verb forms known to introduce a catenative/
// auxiliary chain ("help prevent", "does not treat") whose SECOND verb's
// form is governed by the first, not by independent subject agreement.
// Deliberately NOT "any KNOWN_VERB_BASES word" — many common nouns are
// homographs of common verbs (measure/measures, control/controls,
// result/results), so treating every recognized verb base as a potential
// chain-starter would misread a plural NOUN subject ("Hygiene measures
// limits...") as a chained verb and silently skip a real SVA check.
const CHAIN_VERB_FORMS = new Set(['do', 'does', 'did', 'help', 'helps', 'helped'])

function findSubjectNumber(tokens: string[], verbIndex: number): VerbNumber {
  for (let i = verbIndex - 1; i >= 0 && i >= verbIndex - 4; i--) {
    const word = tokens[i]!
    const lower = word.toLowerCase().replace(/[^a-z]/g, '')
    if (!lower) continue
    if (lower === 'not') continue
    if (ADVERBS_TO_SKIP.has(lower)) continue
    if (DETERMINERS_QUANTIFIERS.has(lower)) continue
    if (MODALS.has(lower)) return null
    if (CHAIN_VERB_FORMS.has(lower)) return null
    if (PLURAL_PRONOUNS.has(lower)) return 'plural'
    if (SINGULAR_PRONOUNS.has(lower)) return 'singular'
    if (IRREGULAR_PLURAL_NOUNS.has(lower)) return 'plural'
    if (/[a-z]s$/.test(lower) && lower.length > 2) return 'plural'
    return 'singular'
  }
  return null
}

function findAll(re: RegExp, text: string): RegExpExecArray[] {
  const matches: RegExpExecArray[] = []
  const global = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')
  let m: RegExpExecArray | null
  while ((m = global.exec(text))) matches.push(m)
  return matches
}

function detectSubjectVerbAgreement(sentence: string, offset: number): GrammarFinding[] {
  const findings: GrammarFinding[] = []

  // Rule 1 (highest confidence): a modal is always followed by a bare-form
  // verb — any modal + a word ending in -s is wrong regardless of subject.
  for (const m of findAll(/\b([A-Za-z]+)\s+([A-Za-z]+s)\b/g, sentence)) {
    const modal = m[1]!.toLowerCase()
    if (!MODALS.has(modal)) continue
    const verb = m[2]!
    if (verb.toLowerCase() === 'is' || verb.toLowerCase() === 'has') continue // "must has" already unlikely; guard anyway
    const base = verb.toLowerCase().endsWith('s') ? verb.slice(0, -1) : verb
    const start = offset + m.index! + m[1]!.length + 1
    findings.push({
      ruleId: 'SVA_MODAL_PLUS_S', category: 'subject_verb_agreement',
      message: `"${modal} ${verb}" — a modal verb must be followed by the base form of the next verb.`,
      start, end: start + verb.length, text: verb, suggestions: [base],
    })
  }

  // Rule 2 (narrow, documented special case): a sentence whose subject is a
  // gerund phrase ("Understanding these pathways...") is always singular,
  // even when a closer plural noun sits right before the verb — §7's
  // nearest-noun-attraction example needs this exception explicitly. Once
  // this pattern is detected at all, Rule 3 is skipped for the whole
  // sentence (correct or not) — its naive nearest-noun scan would otherwise
  // misjudge this exact construction in the other direction.
  const gerundMatch = /^([A-Z][a-z]+ing)\b[\s\S]*?\b(is|are|was|were|has|have|does|do)\b/.exec(sentence)
  if (gerundMatch) {
    const verb = gerundMatch[2]!
    const lowerVerb = verb.toLowerCase()
    const isCorrect = lowerVerb === 'is' || lowerVerb === 'was' || lowerVerb === 'has' || lowerVerb === 'does'
    if (!isCorrect) {
      const idx = sentence.lastIndexOf(verb, sentence.indexOf(gerundMatch[0]) + gerundMatch[0].length)
      const suggestion = lowerVerb === 'have' ? 'has' : lowerVerb === 'were' ? 'was' : lowerVerb === 'do' ? 'does' : 'is'
      findings.push({
        ruleId: 'SVA_GERUND_SUBJECT', category: 'subject_verb_agreement',
        message: `A gerund-phrase subject ("${gerundMatch[1]}...") is grammatically singular.`,
        start: offset + idx, end: offset + idx + verb.length, text: verb, suggestions: [suggestion],
      })
    }
    return findings
  }

  // Rule 3 (general): compare the nearest preceding noun/pronoun's number
  // against the verb's own conjugated number.
  const tokens = sentence.split(/\s+/)
  let cursor = 0
  for (let i = 0; i < tokens.length; i++) {
    const raw = tokens[i]!
    const word = raw.replace(/[^A-Za-z]/g, '')
    const tokenStart = sentence.indexOf(raw, cursor)
    cursor = tokenStart + raw.length
    if (!word) continue
    const lower = word.toLowerCase()
    if (MODALS.has(lower) || lower === 'not') continue

    const analyzed = analyzeVerbForm(word)
    if (!analyzed) continue
    const { number: verbNumber, base } = analyzed
    if (i === 0) continue // sentence-initial word is never the verb here
    const subjectNumber = findSubjectNumber(tokens, i)
    if (subjectNumber == null || subjectNumber === verbNumber) continue

    const suggestion = subjectNumber === 'singular' ? thirdPersonSingularForm(base) : base
    if (suggestion.toLowerCase() === word.toLowerCase()) continue
    findings.push({
      ruleId: 'SVA_SUBJECT_MISMATCH', category: 'subject_verb_agreement',
      message: `"${word}" does not agree in number with its subject.`,
      start: offset + tokenStart, end: offset + tokenStart + word.length, text: word, suggestions: [suggestion],
    })
  }

  return findings
}

// ── Narrower, best-effort rules for the remaining categories (§6) ───────

function detectArticle(sentence: string, offset: number): GrammarFinding[] {
  const findings: GrammarFinding[] = []
  for (const m of findAll(/\b(a|an)\s+([A-Za-z]+)/gi, sentence)) {
    const article = m[1]!.toLowerCase()
    const next = m[2]!
    const startsWithVowelSound = /^[aeiouAEIOU]/.test(next) && !/^u(ni|se|ser)/i.test(next)
    if (article === 'a' && startsWithVowelSound) {
      findings.push({ ruleId: 'ARTICLE_A_AN', category: 'article', message: `"a ${next}" should likely be "an ${next}".`, start: offset + m.index!, end: offset + m.index! + m[0]!.length, text: m[0]!, suggestions: [`an ${next}`] })
    } else if (article === 'an' && !startsWithVowelSound) {
      findings.push({ ruleId: 'ARTICLE_A_AN', category: 'article', message: `"an ${next}" should likely be "a ${next}".`, start: offset + m.index!, end: offset + m.index! + m[0]!.length, text: m[0]!, suggestions: [`a ${next}`] })
    }
  }
  return findings
}

const BAD_COLLOCATIONS: ReadonlyArray<[RegExp, string]> = [
  [/\bdifferent than\b/gi, 'different from'],
  [/\bmarried with\b/gi, 'married to'],
  [/\bcomprised of\b/gi, 'composed of'],
]

function detectPreposition(sentence: string, offset: number): GrammarFinding[] {
  const findings: GrammarFinding[] = []
  for (const [pattern, suggestion] of BAD_COLLOCATIONS) {
    for (const m of findAll(pattern, sentence)) {
      findings.push({ ruleId: 'PREPOSITION_COLLOCATION', category: 'preposition', message: `"${m[0]}" is a non-standard collocation.`, start: offset + m.index!, end: offset + m.index! + m[0]!.length, text: m[0]!, suggestions: [suggestion] })
    }
  }
  return findings
}

function detectPunctuation(sentence: string, offset: number): GrammarFinding[] {
  const findings: GrammarFinding[] = []
  for (const m of findAll(/\s+([,.;:!?])/g, sentence)) {
    findings.push({ ruleId: 'PUNCTUATION_SPACING', category: 'punctuation', message: `Unexpected space before "${m[1]}".`, start: offset + m.index!, end: offset + m.index! + m[0]!.length, text: m[0]!, suggestions: [m[1]!] })
  }
  for (const m of findAll(/([.!?]){2,}/g, sentence)) {
    findings.push({ ruleId: 'PUNCTUATION_DOUBLED', category: 'punctuation', message: `Repeated terminal punctuation "${m[0]}".`, start: offset + m.index!, end: offset + m.index! + m[0]!.length, text: m[0]!, suggestions: [m[1]!] })
  }
  return findings
}

// A conservative comma-splice heuristic: three or more comma-separated
// clauses with no coordinating conjunction anywhere in the sentence is
// flagged as a likely run-on; genuine lists ("apples, oranges, and pears")
// are excluded by requiring each comma-separated segment to itself look
// like a clause (contain a space, i.e. more than one word).
function detectRunOn(sentence: string, offset: number): GrammarFinding[] {
  const segments = sentence.split(',').map(s => s.trim())
  if (segments.length < 3) return []
  const hasConjunction = /\b(and|but|or|nor|so|yet|for)\b/i.test(sentence)
  const allMultiWord = segments.every(s => s.split(/\s+/).filter(Boolean).length >= 2)
  if (hasConjunction || !allMultiWord) return []
  return [{ ruleId: 'RUN_ON_COMMA_SPLICE', category: 'run_on', message: 'Multiple independent clauses joined only by commas.', start: offset, end: offset + sentence.length, text: sentence, suggestions: [] }]
}

const COMMON_AUX_OR_VERB_HINTS = /\b(is|are|was|were|has|have|had|do|does|did|can|could|will|would|shall|should|may|might|must|am)\b/i

// A short word group with no recognizable verb/auxiliary at all is flagged
// as a likely fragment — deliberately conservative (short threshold) to
// avoid flagging genuine short declarative sentences that use an
// unrecognized verb.
function detectFragment(sentence: string, offset: number): GrammarFinding[] {
  const words = sentence.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0 || words.length >= 8) return []
  const hasKnownVerb = words.some(w => KNOWN_VERB_BASES.has(w.toLowerCase().replace(/[^a-z]/g, '')))
  const hasLikelyVerb = hasKnownVerb || COMMON_AUX_OR_VERB_HINTS.test(sentence) || /[a-z]s\b/i.test(sentence) || /ed\b/i.test(sentence)
  if (hasLikelyVerb) return []
  return [{ ruleId: 'FRAGMENT_NO_VERB', category: 'fragment', message: 'No recognizable verb — likely a sentence fragment.', start: offset, end: offset + sentence.length, text: sentence, suggestions: [] }]
}

function detectNumberAgreement(sentence: string, offset: number): GrammarFinding[] {
  const findings: GrammarFinding[] = []
  for (const m of findAll(/\b(this|that)\s+([a-z]+s)\b/gi, sentence)) {
    if (IRREGULAR_PLURAL_NOUNS.has(m[2]!.toLowerCase())) continue
    findings.push({ ruleId: 'DEMONSTRATIVE_NUMBER_MISMATCH', category: 'number_agreement', message: `"${m[0]}" — a singular demonstrative with a plural noun.`, start: offset + m.index!, end: offset + m.index! + m[0]!.length, text: m[0]!, suggestions: [`${m[1] === 'this' ? 'these' : 'those'} ${m[2]}`] })
  }
  for (const m of findAll(/\b(these|those)\s+([a-z]+)\b/gi, sentence)) {
    const noun = m[2]!.toLowerCase()
    if (/s$/.test(noun) || IRREGULAR_PLURAL_NOUNS.has(noun)) continue
    if (DETERMINERS_QUANTIFIERS.has(noun) || MODALS.has(noun)) continue
    findings.push({ ruleId: 'DEMONSTRATIVE_NUMBER_MISMATCH', category: 'number_agreement', message: `"${m[0]}" — a plural demonstrative with a singular noun.`, start: offset + m.index!, end: offset + m.index! + m[0]!.length, text: m[0]!, suggestions: [`${m[1] === 'these' ? 'this' : 'that'} ${noun}`] })
  }
  return findings
}

// Minimal, intentionally narrow coverage for the remaining categories
// (§6 does not require every category to have the same repair strategy) —
// pronoun_agreement, modifier_placement, parallelism, and verb_tense have
// no reliable regex-only signal for the general case without a real parser,
// so this engine reports zero findings for them rather than guessing.
function detectSentenceRules(sentence: string, offset: number): GrammarFinding[] {
  return [
    ...detectSubjectVerbAgreement(sentence, offset),
    ...detectArticle(sentence, offset),
    ...detectPreposition(sentence, offset),
    ...detectPunctuation(sentence, offset),
    ...detectRunOn(sentence, offset),
    ...detectFragment(sentence, offset),
    ...detectNumberAgreement(sentence, offset),
  ]
}

// Runs every rule sentence-by-sentence and reassembles absolute offsets
// into the ORIGINAL text (splitSentences trims each sentence, so this
// re-locates each one in the source rather than assuming contiguous
// concatenation).
export function detectGrammarFindings(text: string): GrammarFinding[] {
  const sentences = splitSentences(text)
  const findings: GrammarFinding[] = []
  let searchFrom = 0
  for (const sentence of sentences) {
    const idx = text.indexOf(sentence, searchFrom)
    const offset = idx === -1 ? searchFrom : idx
    findings.push(...detectSentenceRules(sentence, offset))
    searchFrom = offset + sentence.length
  }
  return findings
}

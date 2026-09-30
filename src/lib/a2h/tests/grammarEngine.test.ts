import { describe, it, expect } from 'vitest'
import { detectGrammarFindings, GRAMMAR_ENGINE_CONFIG } from '../grammarEngine'

// §7's ten canonical subject-verb-agreement examples — every one of these
// must be FLAGGED on the corrupted (left) side.
const SVA_EXAMPLES: Array<[string, string]> = [
  ['A pathogen enter the bloodstream.', 'A pathogen enters the bloodstream.'],
  ['Some bacteria produces toxins.', 'Some bacteria produce toxins.'],
  ['Protozoan parasites often has complex life cycles.', 'Protozoan parasites often have complex life cycles.'],
  ['The immune system recognize the pathogen.', 'The immune system recognizes the pathogen.'],
  ['These mechanisms helps prevent transmission.', 'These mechanisms help prevent transmission.'],
  ['They does not treat viral infections.', 'They do not treat viral infections.'],
  ['Overuse can promotes resistance.', 'Overuse can promote resistance.'],
  ['Vaccination reduce disease severity.', 'Vaccination reduces disease severity.'],
  ['Hygiene measures limits transmission.', 'Hygiene measures limit transmission.'],
  ['Understanding these pathways are essential.', 'Understanding these pathways is essential.'],
]

describe('detectGrammarFindings — §7 subject-verb agreement examples', () => {
  it.each(SVA_EXAMPLES)('flags the corrupted form: %s', (corrupted) => {
    const findings = detectGrammarFindings(corrupted)
    expect(findings.some(f => f.category === 'subject_verb_agreement')).toBe(true)
  })

  it.each(SVA_EXAMPLES)('does not flag the clean form: %s', (_corrupted, clean) => {
    const findings = detectGrammarFindings(clean)
    expect(findings.filter(f => f.category === 'subject_verb_agreement')).toHaveLength(0)
  })
})

describe('GRAMMAR_ENGINE_CONFIG', () => {
  it('is versioned and has a stable, non-empty config hash', () => {
    expect(GRAMMAR_ENGINE_CONFIG.engine).toBe('a2h-rule-engine')
    expect(GRAMMAR_ENGINE_CONFIG.version).toMatch(/^GRAMMAR-V\d+$/)
    expect(GRAMMAR_ENGINE_CONFIG.configHash).toHaveLength(16)
  })
})

describe('detectGrammarFindings — other categories (best-effort)', () => {
  it('flags a/an misuse', () => {
    expect(detectGrammarFindings('She ate a apple.').some(f => f.category === 'article')).toBe(true)
    expect(detectGrammarFindings('She ate an banana.').some(f => f.category === 'article')).toBe(true)
    expect(detectGrammarFindings('She ate an apple.').some(f => f.category === 'article')).toBe(false)
  })

  it('flags doubled terminal punctuation', () => {
    expect(detectGrammarFindings('What is happening??').some(f => f.category === 'punctuation')).toBe(true)
  })

  it('flags a likely comma-spliced run-on', () => {
    const text = 'The patient arrived early, the doctor was ready, the surgery began on time.'
    expect(detectGrammarFindings(text).some(f => f.category === 'run_on')).toBe(true)
  })

  it('does not flag a normal list as a run-on', () => {
    const text = 'The kit includes gloves, masks, and gowns.'
    expect(detectGrammarFindings(text).some(f => f.category === 'run_on')).toBe(false)
  })

  it('flags a short fragment with no verb', () => {
    expect(detectGrammarFindings('Because of the weather.').some(f => f.category === 'fragment')).toBe(true)
  })

  it('flags demonstrative/number mismatches', () => {
    expect(detectGrammarFindings('This reasons are unclear.').some(f => f.category === 'number_agreement')).toBe(true)
    expect(detectGrammarFindings('These reason is unclear.').some(f => f.category === 'number_agreement')).toBe(true)
  })
})

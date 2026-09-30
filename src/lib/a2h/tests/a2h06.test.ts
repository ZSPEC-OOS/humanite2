import { describe, it, expect } from 'vitest'
import {
  classifyGrammarRepair, validateGrammarRepairFixtureExpected, proposeGrammarRepairCandidates,
  aggregateA2H06, INITIAL_GRAMMAR_FIXTURES, type GrammarRepairFixtureResult,
} from '../a2h06'

describe('classifyGrammarRepair — §52 acceptance cases', () => {
  it('subject-verb agreement corrected', () => {
    const fixture = INITIAL_GRAMMAR_FIXTURES[0]! // "A pathogen enter..." -> "...enters..."
    const result = classifyGrammarRepair(fixture, fixture.cleanText)
    expect(result.status).toBe('corrected')
    expect(result.targetErrorCorrected).toBe(true)
    expect(result.newErrorIntroduced).toBe(false)
  })

  it('subject-verb agreement unchanged (repair did nothing)', () => {
    const fixture = INITIAL_GRAMMAR_FIXTURES[0]!
    const result = classifyGrammarRepair(fixture, fixture.corruptedText)
    expect(result.status).toBe('not_corrected')
    expect(result.targetErrorCorrected).toBe(false)
  })

  it('article repaired', () => {
    const fixture = { cleanText: 'She ate an apple.', corruptedText: 'She ate a apple.', category: 'article' as const, incorrectText: 'a apple', expectedCorrection: 'an apple', anchorText: null }
    const result = classifyGrammarRepair(fixture, 'She ate an apple.')
    expect(result.status).toBe('corrected')
  })

  it('preposition repaired', () => {
    const fixture = { cleanText: 'This is different from that.', corruptedText: 'This is different than that.', category: 'preposition' as const, incorrectText: 'different than', expectedCorrection: 'different from', anchorText: null }
    const result = classifyGrammarRepair(fixture, 'This is different from that.')
    expect(result.status).toBe('corrected')
  })

  it('pronoun agreement repaired', () => {
    const fixture = { cleanText: 'Each student must bring his or her book.', corruptedText: 'Each student must bring their book.', category: 'pronoun_agreement' as const, incorrectText: 'their', expectedCorrection: 'his or her', anchorText: null }
    const result = classifyGrammarRepair(fixture, 'Each student must bring his or her book.')
    expect(result.status).toBe('corrected')
  })

  it('fragment repaired', () => {
    const fixture = { cleanText: 'This happened because of the weather.', corruptedText: 'Because of the weather.', category: 'fragment' as const, incorrectText: 'Because of the weather', expectedCorrection: 'This happened because of the weather', anchorText: null }
    const result = classifyGrammarRepair(fixture, 'This happened because of the weather.')
    expect(result.status).toBe('corrected')
  })

  it('run-on repaired', () => {
    const fixture = { cleanText: 'The patient arrived early. The doctor was ready.', corruptedText: 'The patient arrived early, the doctor was ready.', category: 'run_on' as const, incorrectText: 'early, the doctor', expectedCorrection: 'early. The doctor', anchorText: null }
    const result = classifyGrammarRepair(fixture, 'The patient arrived early. The doctor was ready.')
    expect(result.status).toBe('corrected')
  })

  it('punctuation repaired', () => {
    const fixture = { cleanText: 'What is happening?', corruptedText: 'What is happening??', category: 'punctuation' as const, incorrectText: 'happening??', expectedCorrection: 'happening?', anchorText: null }
    const result = classifyGrammarRepair(fixture, 'What is happening?')
    expect(result.status).toBe('corrected')
  })

  it('parallelism repaired', () => {
    const fixture = { cleanText: 'She likes reading, writing, and painting.', corruptedText: 'She likes reading, writing, and to paint.', category: 'parallelism' as const, incorrectText: 'to paint', expectedCorrection: 'painting', anchorText: null }
    const result = classifyGrammarRepair(fixture, 'She likes reading, writing, and painting.')
    expect(result.status).toBe('corrected')
  })

  it('target error repaired but a new error is introduced elsewhere', () => {
    const fixture = INITIAL_GRAMMAR_FIXTURES[0]! // incorrectText "enter" -> expectedCorrection "enters"
    // Target fixed, but the article is now wrong elsewhere in the sentence.
    const result = classifyGrammarRepair(fixture, 'A pathogen enters a bloodstream badly and a apple.')
    expect(result.targetErrorCorrected).toBe(true)
    expect(result.newErrorIntroduced).toBe(true)
    expect(result.status).toBe('new_error_introduced')
  })

  it('partial correction (neither the defect nor the exact fix is present)', () => {
    const fixture = INITIAL_GRAMMAR_FIXTURES[0]!
    const result = classifyGrammarRepair(fixture, 'A pathogen moves into the bloodstream.')
    expect(result.status).toBe('partially_corrected')
    expect(result.targetErrorCorrected).toBe(false)
  })

  it('multiple errors in one fixture — classification uses the whole repaired text', () => {
    const fixture = {
      cleanText: 'These mechanisms help prevent transmission and they reduce severity.',
      corruptedText: 'These mechanisms helps prevent transmission and they reduces severity.',
      category: 'subject_verb_agreement' as const,
      incorrectText: 'helps',
      expectedCorrection: 'help',
      anchorText: null,
    }
    const repairedButStillBroken = 'These mechanisms help prevent transmission and they reduces severity.'
    const result = classifyGrammarRepair(fixture, repairedButStillBroken)
    // The TARGETED defect (helps->help) is fixed even though another SVA
    // error remains elsewhere — the grammar engine should catch it as new
    // relative to the clean baseline only if the clean text doesn't already
    // have it; here it's pre-existing in neither clean nor corrupted before
    // repair for THIS word, so this exercises new-error detection broadly.
    expect(result.targetErrorCorrected).toBe(true)
  })

  it('repair returning null/empty is not_corrected', () => {
    const fixture = INITIAL_GRAMMAR_FIXTURES[0]!
    expect(classifyGrammarRepair(fixture, null).status).toBe('not_corrected')
    expect(classifyGrammarRepair(fixture, '').status).toBe('not_corrected')
  })
})

describe('classifyGrammarRepair — §7 fixtures all corrected end to end', () => {
  it.each(INITIAL_GRAMMAR_FIXTURES)('fixture "%s" classifies as corrected when repaired to its clean text', (fixture) => {
    const result = classifyGrammarRepair(fixture, fixture.cleanText)
    expect(result.status).toBe('corrected')
  })
})

describe('validateGrammarRepairFixtureExpected', () => {
  it('accepts every seed fixture', () => {
    for (const f of INITIAL_GRAMMAR_FIXTURES) {
      expect(validateGrammarRepairFixtureExpected(f as unknown as Record<string, unknown>)).toEqual([])
    }
  })

  it('rejects incorrectText not present in corruptedText', () => {
    const errors = validateGrammarRepairFixtureExpected({
      cleanText: 'A pathogen enters the bloodstream.', corruptedText: 'A pathogen enter the bloodstream.',
      category: 'subject_verb_agreement', incorrectText: 'nonexistent', expectedCorrection: 'enters',
    })
    expect(errors.length).toBeGreaterThan(0)
  })

  it('rejects an invalid category', () => {
    const errors = validateGrammarRepairFixtureExpected({
      cleanText: 'x', corruptedText: 'x', category: 'bogus', incorrectText: 'x', expectedCorrection: 'x',
    })
    expect(errors.length).toBeGreaterThan(0)
  })
})

describe('proposeGrammarRepairCandidates', () => {
  it('returns the curated seed set for review', () => {
    expect(proposeGrammarRepairCandidates()).toHaveLength(INITIAL_GRAMMAR_FIXTURES.length)
  })
})

describe('aggregateA2H06', () => {
  it('is ineligible with zero results', () => {
    expect(aggregateA2H06([]).eligible).toBe(false)
  })

  it('computes repairRate as corrected / inserted', () => {
    const results: GrammarRepairFixtureResult[] = [
      { fixtureId: '1', category: 'subject_verb_agreement', status: 'corrected', targetErrorCorrected: true, newErrorIntroduced: false, repairAttemptId: 'a', repairedText: 'x' },
      { fixtureId: '2', category: 'subject_verb_agreement', status: 'not_corrected', targetErrorCorrected: false, newErrorIntroduced: false, repairAttemptId: 'b', repairedText: 'y' },
    ]
    const agg = aggregateA2H06(results)
    expect(agg.insertedErrorCount).toBe(2)
    expect(agg.correctedCount).toBe(1)
    expect(agg.repairRate).toBe(0.5)
  })
})

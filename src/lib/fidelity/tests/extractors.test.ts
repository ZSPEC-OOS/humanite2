import { describe, it, expect } from 'vitest'
import { extractQuantities } from '../extractors/quantities'
import { extractRanges } from '../extractors/ranges'
import { extractScientificNotation } from '../extractors/scientificNotation'
import { extractModality } from '../extractors/modality'
import { extractNegation } from '../extractors/negation'
import { extractVersionNumbers } from '../extractors/versionNumbers'
import { extractCrossReferences } from '../extractors/crossReferences'
import { extractEntityPairs } from '../extractors/entityPairs'
import { extractCitations } from '../extractors/citations'
import { extractDates } from '../extractors/dates'
import { extractEquations } from '../extractors/equations'
import { extractChemicals } from '../extractors/chemicals'

describe('extractQuantities', () => {
  it('captures a recognized unit symbol', () => {
    const [fact] = extractQuantities('Store at 5 mg per vial.', 0)
    expect(fact?.data).toEqual({ operator: null, sign: null, value: '5', unit: 'mg' })
  })

  it('captures a spelled-out unit word outside the symbol whitelist', () => {
    const facts = extractQuantities('It costs 200 dollars.', 0)
    expect(facts.some(f => f.data.value === '200' && f.data.unit === 'dollars')).toBe(true)
  })

  it('captures a leading comparator bound to the value', () => {
    const facts = extractQuantities('yielded p > 0.05.', 0)
    expect(facts.some(f => f.data.operator === '>' && f.data.value === '0.05')).toBe(true)
  })

  it('captures a leading sign bound to the value', () => {
    const facts = extractQuantities('changed by +5%.', 0)
    expect(facts.some(f => f.data.sign === '+' && f.data.value === '5' && f.data.unit === '%')).toBe(true)
  })

  it('does not fragment a longer digit run into a spurious partial match', () => {
    // \d{1,3} without a comma group can't fully consume "1234" — this must
    // produce no match at all, never a truncated "234".
    const facts = extractQuantities('The code is 1234 exactly.', 0)
    expect(facts.some(f => f.data.value === '234')).toBe(false)
  })

  it('does not backtrack into dropping the unit when it is followed by punctuation', () => {
    const [fact] = extractQuantities('Store at 5 mg.', 0)
    expect(fact?.data.unit).toBe('mg')
  })
})

describe('extractRanges', () => {
  it('captures an ordered (low, high) pair from "from...to"', () => {
    const [fact] = extractRanges('spans from 5 mg to 20 mg.', 0)
    expect(fact?.data).toEqual({ low: '5 mg', high: '20 mg' })
  })

  it('captures an ordered pair from "between...and"', () => {
    const [fact] = extractRanges('ranges between 2.1 and 5.8 millimeters.', 0)
    expect(fact?.data).toEqual({ low: '2.1', high: '5.8 millimeters' })
  })
})

describe('extractScientificNotation', () => {
  it('captures the full span including the exponent sign', () => {
    const [fact] = extractScientificNotation('was 3.2 x 10^-4 mol/L.', 0)
    expect(fact?.data.text).toContain('10^-4')
  })

  it('captures "e" notation', () => {
    const [fact] = extractScientificNotation('a rate of 1.5e-3 per second.', 0)
    expect(fact?.data.text).toBe('1.5e-3')
  })
})

describe('extractModality', () => {
  it('captures each of the plan\'s named modal words', () => {
    for (const word of ['must', 'shall', 'may', 'should', 'will']) {
      const [fact] = extractModality(`The system ${word} comply.`, 0)
      expect(fact?.data.modal).toBe(word)
    }
  })
})

describe('extractNegation', () => {
  it('reports a count of 1 for a single negation marker', () => {
    const [fact] = extractNegation('The results did not increase.', 0)
    expect(fact?.data).toEqual({ count: 1 })
  })

  it('reports no fact at all when there is no negation', () => {
    expect(extractNegation('The results increased.', 0)).toHaveLength(0)
  })

  it('counts two markers in a double negation', () => {
    const [fact] = extractNegation('It is not without merit.', 0)
    expect(fact?.data).toEqual({ count: 2 })
  })
})

describe('extractVersionNumbers', () => {
  it('binds a version to the entity preceding it in the same clause', () => {
    const facts = extractVersionNumbers('Server Alpha runs firmware 2.1; Server Beta runs firmware 3.4.', 0)
    expect(facts).toContainEqual(expect.objectContaining({ data: { entity: 'server alpha', version: 'firmware 2.1' } }))
    expect(facts).toContainEqual(expect.objectContaining({ data: { entity: 'server beta', version: 'firmware 3.4' } }))
  })

  it('binds a version to the entity following it when the entity comes second', () => {
    const [fact] = extractVersionNumbers('Version 4.2.0 comes pre-installed on Model A.', 0)
    expect(fact?.data.entity).toBe('model a')
  })

  it('does not bind a bare decimal with no version-indicating trigger', () => {
    expect(extractVersionNumbers('The p-value was 0.05.', 0)).toHaveLength(0)
  })
})

describe('extractCrossReferences', () => {
  it('binds a reference to its purpose in "Section N for X" order', () => {
    const [fact] = extractCrossReferences('See Section 4 for methodology.', 0)
    expect(fact?.data).toEqual({ kind: 'section', number: '4', purpose: 'methodology' })
  })

  it('binds a reference to its purpose in the reversed "X ... in Section N" order', () => {
    const [fact] = extractCrossReferences('Methodology appears in Section 4.', 0)
    expect(fact?.data).toEqual({ kind: 'section', number: '4', purpose: 'methodology' })
  })
})

describe('extractEntityPairs', () => {
  it('binds first/second entities across a comparative "than" construction', () => {
    const [fact] = extractEntityPairs('Compound A showed higher potency than Compound B in the assay.', 0)
    expect(fact?.data).toEqual({ first: 'compound a', second: 'compound b' })
  })

  it('does not bind when only one entity label is present', () => {
    expect(extractEntityPairs('Compound A showed higher potency than expected.', 0)).toHaveLength(0)
  })
})

describe('thin re-export extractors (existing regex locks, sentence-bound)', () => {
  it('extractCitations finds a bracketed citation', () => {
    expect(extractCitations('prior work [12].', 0)).toHaveLength(1)
  })

  it('extractDates finds a written-out date', () => {
    expect(extractDates('filed on January 5, 2024.', 0)).toHaveLength(1)
  })

  it('extractEquations finds LaTeX-delimited math', () => {
    expect(extractEquations('the identity $E = mc^2$ holds.', 0)).toHaveLength(1)
  })

  it('extractChemicals finds a formula-shaped token', () => {
    expect(extractChemicals('water is H2O.', 0).some(f => f.text === 'H2O')).toBe(true)
  })
})

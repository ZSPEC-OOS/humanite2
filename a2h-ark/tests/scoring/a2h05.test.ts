import { describe, it, expect } from 'vitest'
import { computeA2H05Measurements, validateNumericUnitFixtureExpected, deriveNumericUnitFixtureExpected } from '../../src/scoring/a2h05'
import { parseNumericExpression } from '../../src/shared/numericParser'
import type { BenchmarkFixture } from '../../src/shared/types'
import type { NumericUnitFixtureExpected } from '../../src/scoring/a2h05'

let ordinal = 0
function fixture(kind: NumericUnitFixtureExpected['kind'], exactText: string): BenchmarkFixture {
  const expected = deriveNumericUnitFixtureExpected(kind, exactText)
  if (!expected) throw new Error(`Test setup: "${exactText}" does not parse as ${kind}`)
  return {
    id: `fx-${++ordinal}`, fixtureSetId: 'set-1', corpusProjectId: 'proj-1', sourceId: 'src-1',
    type: 'numeric_unit', ordinal, expected: expected as unknown as Record<string, unknown>,
    sourceStart: null, sourceEnd: null, sourceText: null, notes: null, corruptionGeneratorVersion: null,
    createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z',
  }
}

function classify(kind: NumericUnitFixtureExpected['kind'], exactText: string, outputText: string) {
  const m = computeA2H05Measurements([fixture(kind, exactText)], outputText)
  return m.fixtures[0]!.status
}

describe('numericParser', () => {
  it('parses integers, decimals, and canonicalizes decimal formatting', () => {
    expect(parseNumericExpression('integer', '5')?.numericValue).toBe(5)
    expect(parseNumericExpression('decimal', '5.0')?.normalizedValue).toBe('5')
    expect(parseNumericExpression('decimal', '5.0')?.normalizedValue).toBe(parseNumericExpression('decimal', '5')?.normalizedValue ?? parseNumericExpression('integer', '5')?.normalizedValue)
  })

  it('parses percentages including spelled-out and signed forms', () => {
    expect(parseNumericExpression('percentage', '5%')?.numericValue).toBe(5)
    expect(parseNumericExpression('percentage', '5 percent')?.numericValue).toBe(5)
    expect(parseNumericExpression('percentage', '+5%')?.sign).toBe('+')
    expect(parseNumericExpression('percentage', '-5%')?.sign).toBe('-')
  })

  it('parses currency amounts', () => {
    expect(parseNumericExpression('currency', '$200')).toEqual(expect.objectContaining({ numericValue: 200, unit: '$' }))
    expect(parseNumericExpression('currency', '€200')).toEqual(expect.objectContaining({ numericValue: 200, unit: '€' }))
  })

  it('normalizes equivalent date notations to the same ISO string', () => {
    expect(parseNumericExpression('date', '2024-05-17')?.normalizedValue).toBe('2024-05-17')
    expect(parseNumericExpression('date', 'May 17, 2024')?.normalizedValue).toBe('2024-05-17')
  })

  it('parses value+unit pairs including compound units', () => {
    expect(parseNumericExpression('value_unit', '5 mg')).toEqual(expect.objectContaining({ numericValue: 5, unit: 'mg' }))
    expect(parseNumericExpression('value_unit', '5 mg/mL')).toEqual(expect.objectContaining({ numericValue: 5, unit: 'mg/mL' }))
  })

  it('parses ranges with a dash or "to"', () => {
    expect(parseNumericExpression('range', '5-20 mg')).toEqual(expect.objectContaining({ rangeStart: 5, rangeEnd: 20, unit: 'mg' }))
    expect(parseNumericExpression('range', '5 to 20 mg')).toEqual(expect.objectContaining({ rangeStart: 5, rangeEnd: 20, unit: 'mg' }))
  })

  it('parses scientific notation in × and e forms', () => {
    expect(parseNumericExpression('scientific_notation', '3.2 × 10^-4')).toEqual(expect.objectContaining({ numericValue: 3.2, exponent: -4 }))
    expect(parseNumericExpression('scientific_notation', '3.2 x 10^-4')).toEqual(expect.objectContaining({ numericValue: 3.2, exponent: -4 }))
    expect(parseNumericExpression('scientific_notation', '1e-4')).toEqual(expect.objectContaining({ numericValue: 1, exponent: -4 }))
  })

  it('normalizes a cosmetic v-prefix on version numbers without altering the number', () => {
    expect(parseNumericExpression('version_number', 'v2.1')?.normalizedValue).toBe('2.1')
    expect(parseNumericExpression('version_number', '2.1.3')?.normalizedValue).toBe('2.1.3')
  })

  it('returns null (never guesses) for text that does not match the kind', () => {
    expect(parseNumericExpression('integer', 'five')).toBeNull()
    expect(parseNumericExpression('percentage', '5 mg')).toBeNull()
  })
})

// §41's required acceptance cases.
describe('computeA2H05Measurements — §41 acceptance cases', () => {
  it('5 mg -> 5 mg: preserved', () => {
    expect(classify('value_unit', '5 mg', 'Administer 5 mg daily.')).toBe('preserved')
  })

  it('5 mg -> 50 mg: value_changed', () => {
    expect(classify('value_unit', '5 mg', 'Administer 50 mg daily.')).toBe('value_changed')
  })

  it('5 mg -> 5 g: unit_changed', () => {
    expect(classify('value_unit', '5 mg', 'Administer 5 g daily.')).toBe('unit_changed')
  })

  it('+5% -> -5%: sign_flipped', () => {
    expect(classify('percentage', '+5%', 'Revenue changed by -5% year over year.')).toBe('sign_flipped')
  })

  it('5-20 mg -> 20-5 mg: range_altered', () => {
    expect(classify('range', '5-20 mg', 'The dosing range spans from 20-5 mg.')).toBe('range_altered')
  })

  it('3.2 x 10^-4 -> 3.2 x 10^4: scientific_notation_altered', () => {
    expect(classify('scientific_notation', '3.2 x 10^-4', 'The concentration was 3.2 x 10^4 mol/L.')).toBe('scientific_notation_altered')
  })

  it('$200 -> €200: unit_changed (currency)', () => {
    expect(classify('currency', '$200', 'The shipment costs €200.')).toBe('unit_changed')
  })

  it('2024 -> 2025: value_changed', () => {
    expect(classify('integer', '2024', 'The report covers fiscal year 2025.')).toBe('value_changed')
  })

  it('v2.1 -> v2.2: version_changed', () => {
    expect(classify('version_number', 'v2.1', 'Server Alpha runs firmware v2.2.')).toBe('version_changed')
  })

  it('decimal formatting equivalence: 5.0 and 5 are preserved', () => {
    expect(classify('decimal', '5.0', 'The result was 5.0 exactly.')).toBe('preserved')
  })

  it('a fully dropped fixture is missing', () => {
    expect(classify('value_unit', '5 mg', 'No dosage mentioned at all.')).toBe('missing')
  })
})

describe('computeA2H05Measurements aggregate behavior', () => {
  it('is ineligible with zero numeric_unit fixtures', () => {
    const m = computeA2H05Measurements([], 'irrelevant')
    expect(m.eligible).toBe(false)
    expect(m.preservationRate).toBeNull()
  })

  it('detects an unexpected new numeric expression not tied to any fixture', () => {
    const m = computeA2H05Measurements([fixture('value_unit', '5 mg')], 'Administer 5 mg, then follow up with 10 mg.')
    expect(m.preservedCount).toBe(1)
    expect(m.unexpectedCount).toBe(1)
  })

  it('sums category counts correctly across multiple fixtures', () => {
    const fixtures = [fixture('value_unit', '5 mg'), fixture('percentage', '+5%')]
    const m = computeA2H05Measurements(fixtures, 'Administer 50 mg. Revenue changed by -5%.')
    expect(m.valueChangedCount).toBe(1)
    expect(m.signFlippedCount).toBe(1)
    expect(m.expectedCount).toBe(2)
  })
})

describe('validateNumericUnitFixtureExpected', () => {
  it('accepts a well-formed fixture derived from exactText', () => {
    const expected = deriveNumericUnitFixtureExpected('value_unit', '5 mg')!
    expect(validateNumericUnitFixtureExpected(expected as unknown as Record<string, unknown>)).toEqual([])
  })

  it('rejects exactText that does not parse as the declared kind', () => {
    expect(validateNumericUnitFixtureExpected({ kind: 'percentage', exactText: '5 mg', normalizedValue: '5 mg' }).length).toBeGreaterThan(0)
  })

  it('rejects a normalizedValue that disagrees with the deterministic parse', () => {
    expect(validateNumericUnitFixtureExpected({ kind: 'value_unit', exactText: '5 mg', normalizedValue: '50 mg' }).length).toBeGreaterThan(0)
  })
})

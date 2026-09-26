import { describe, it, expect } from 'vitest'
import { measureIntensity } from '../intensity'

describe('measureIntensity — identical text', () => {
  it('reports zero on every metric when the output exactly matches the source', () => {
    const text = 'The cat sat on the mat. It looked content. The sun was warm.'
    const result = measureIntensity(text, text)
    expect(result.tokenEditRatio).toBe(0)
    expect(result.lexicalReplacementRatio).toBe(0)
    expect(result.sentenceBoundaryChangeRatio).toBe(0)
    expect(result.sentenceOrderChangeRatio).toBe(0)
    expect(result.paragraphBoundaryChangeRatio).toBe(0)
    expect(result.transformationMagnitude).toBe(0)
  })
})

describe('measureIntensity — tokenEditRatio', () => {
  it('reports a high ratio for two texts sharing no vocabulary at all', () => {
    const result = measureIntensity(
      'Apples are red fruits grown in orchards.',
      'Quantum circuits require careful calibration procedures.',
    )
    expect(result.tokenEditRatio).toBeGreaterThan(0.9)
  })

  it('reports a low but nonzero ratio for a lightly edited sentence', () => {
    const result = measureIntensity(
      'The results were clear and consistent across every trial.',
      'The results were clear and consistent across each trial.',
    )
    expect(result.tokenEditRatio).toBeGreaterThan(0)
    expect(result.tokenEditRatio).toBeLessThan(0.3)
  })
})

describe('measureIntensity — lexicalReplacementRatio excludes locked spans', () => {
  it('reports a higher ratio when the replaced words are excluded from the denominator via lockedTexts', () => {
    const source = 'The value is 42 and rising steadily this quarter.'
    const output = 'The figure is 42 and increasing steadily this quarter.'
    const withoutLocks = measureIntensity(source, output, [])
    const withLocks = measureIntensity(source, output, ['42'])
    // Same diff, smaller denominator (source word count minus the locked
    // token) — the ratio must be strictly larger, not just non-decreasing.
    expect(withLocks.lexicalReplacementRatio).toBeGreaterThan(withoutLocks.lexicalReplacementRatio)
  })
})

describe('measureIntensity — sentence vs paragraph boundary changes', () => {
  it('detects a sentence split (more sentences in the output than the source)', () => {
    const source = 'The report covers three areas: revenue, cost, and headcount changes this quarter.'
    const output = 'The report covers revenue. It also covers cost. It also covers headcount changes this quarter.'
    const result = measureIntensity(source, output)
    expect(result.sentenceBoundaryChangeRatio).toBeGreaterThan(0)
  })

  it('detects a paragraph split (more paragraphs in the output than the source)', () => {
    const source = 'First point stands on its own. Second point follows directly after it.'
    const output = 'First point stands on its own.\n\nSecond point follows directly after it.'
    const result = measureIntensity(source, output)
    expect(result.paragraphBoundaryChangeRatio).toBeGreaterThan(0)
  })

  it('reports zero paragraph change when the paragraph count is unchanged, even if sentences moved within it', () => {
    const source = 'First point stands. Second point follows.'
    const output = 'Second point follows. First point stands.'
    const result = measureIntensity(source, output)
    expect(result.paragraphBoundaryChangeRatio).toBe(0)
  })
})

describe('measureIntensity — sentenceOrderChangeRatio is distinct from boundary changes', () => {
  it('detects reordered sentences even when the sentence count is unchanged', () => {
    const source = 'Apples are red fruits. Bananas are yellow fruits. Cherries are small red fruits.'
    const output = 'Bananas are yellow fruits. Apples are red fruits. Cherries are small red fruits.'
    const result = measureIntensity(source, output)
    expect(result.sentenceBoundaryChangeRatio).toBe(0)
    expect(result.sentenceOrderChangeRatio).toBeGreaterThan(0)
  })

  it('reports zero order change when sentences are rephrased but kept in their original order', () => {
    const source = 'Apples are red fruits. Bananas are yellow fruits. Cherries are small red fruits.'
    const output = 'Apples are red fruits indeed. Bananas are yellow fruits indeed. Cherries are small red fruits indeed.'
    const result = measureIntensity(source, output)
    expect(result.sentenceOrderChangeRatio).toBe(0)
  })
})

describe('measureIntensity — transformationMagnitude', () => {
  it('is the mean of the five component ratios', () => {
    const result = measureIntensity(
      'Apples are red fruits. Bananas are yellow fruits.',
      'Bananas are a yellow fruit.\n\nCitrus trees produce oranges in warm climates.',
    )
    const mean = (
      result.tokenEditRatio +
      result.lexicalReplacementRatio +
      result.sentenceBoundaryChangeRatio +
      result.sentenceOrderChangeRatio +
      result.paragraphBoundaryChangeRatio
    ) / 5
    expect(result.transformationMagnitude).toBeCloseTo(mean, 6)
  })

  it('increases monotonically as progressively more of the source is altered', () => {
    const source = 'Apples are red fruits grown in orchards near the valley every autumn season.'
    const lightlyEdited = 'Apples are red fruits grown in orchards near the valley every autumn.'
    const heavilyEdited = 'In warm valleys each autumn, orchards yield red apples for harvest.'
    const unrecognizable = 'Quantum circuits require careful calibration procedures under strict conditions.'

    const light = measureIntensity(source, lightlyEdited).transformationMagnitude
    const heavy = measureIntensity(source, heavilyEdited).transformationMagnitude
    const extreme = measureIntensity(source, unrecognizable).transformationMagnitude

    expect(heavy).toBeGreaterThan(light)
    expect(extreme).toBeGreaterThan(heavy)
  })
})

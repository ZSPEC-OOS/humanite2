import { describe, it, expect } from 'vitest'
import { CORPUS } from '../corpus'
import { DOMAINS } from '../types'

describe('benchmark corpus — structural integrity', () => {
  it('has exactly 50 documents per domain across all 6 domains (300 total, per the Phase 11 scale-up)', () => {
    expect(CORPUS).toHaveLength(300)
    for (const domain of DOMAINS) {
      expect(CORPUS.filter(item => item.domain === domain)).toHaveLength(50)
    }
  })

  it('has a unique id for every item', () => {
    const ids = CORPUS.map(item => item.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every mandatory fact is an exact substring of its own item\'s input', () => {
    for (const item of CORPUS) {
      for (const fact of item.mandatoryFacts) {
        expect(item.input.includes(fact), `${item.id}: mandatoryFact ${JSON.stringify(fact)} not found in input`).toBe(true)
      }
    }
  })

  it('every prohibited change is absent from its own item\'s input (it must only ever appear via corruption)', () => {
    for (const item of CORPUS) {
      for (const change of item.prohibitedChanges) {
        expect(item.input.includes(change), `${item.id}: prohibitedChange ${JSON.stringify(change)} unexpectedly already present in input`).toBe(false)
      }
    }
  })

  it('every item\'s word count falls within its own declared bounds', () => {
    for (const item of CORPUS) {
      const words = item.input.trim().split(/\s+/).length
      expect(words, `${item.id}: word count ${words}`).toBeGreaterThanOrEqual(item.expectedProperties.minWordCount)
      expect(words, `${item.id}: word count ${words}`).toBeLessThanOrEqual(item.expectedProperties.maxWordCount)
    }
  })

  it('every item declares at least one mandatory fact and one prohibited change', () => {
    for (const item of CORPUS) {
      expect(item.mandatoryFacts.length, `${item.id}`).toBeGreaterThan(0)
      expect(item.prohibitedChanges.length, `${item.id}`).toBeGreaterThan(0)
    }
  })
})

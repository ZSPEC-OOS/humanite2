import { describe, it, expect } from 'vitest'
import { normalizeTopicTitle, countDuplicateTitlesByDomain, titlesLikelyOverlap } from '../textNormalize'

describe('normalizeTopicTitle', () => {
  it('collapses case, punctuation, and whitespace differences to the same key', () => {
    expect(normalizeTopicTitle('Hypertension')).toBe(normalizeTopicTitle('hypertension'))
    expect(normalizeTopicTitle('Hypertension')).toBe(normalizeTopicTitle('Hypertension.'))
  })
})

describe('countDuplicateTitlesByDomain', () => {
  it('does not flag the same normalized title used in two different domains', () => {
    const topics = [
      { domainId: 'legal', title: 'Contract Law Basics' },
      { domainId: 'business', title: 'Contract Law Basics' },
    ]
    expect(countDuplicateTitlesByDomain(topics)).toBe(0)
  })

  it('flags a normalized duplicate within the same domain', () => {
    const topics = [
      { domainId: 'medical', title: 'Hypertension' },
      { domainId: 'medical', title: 'hypertension.' },
    ]
    expect(countDuplicateTitlesByDomain(topics)).toBe(1)
  })

  it('counts multiple duplicate groups within one domain separately', () => {
    const topics = [
      { domainId: 'medical', title: 'Hypertension' },
      { domainId: 'medical', title: 'Hypertension' },
      { domainId: 'medical', title: 'Asthma' },
      { domainId: 'medical', title: 'asthma' },
      { domainId: 'medical', title: 'Diabetes' },
    ]
    expect(countDuplicateTitlesByDomain(topics)).toBe(2)
  })

  it('a duplicate in one domain does not affect the count for another', () => {
    const topics = [
      { domainId: 'medical', title: 'Hypertension' },
      { domainId: 'medical', title: 'Hypertension' },
      { domainId: 'legal', title: 'Contract Basics' },
    ]
    expect(countDuplicateTitlesByDomain(topics)).toBe(1)
  })

  it('returns 0 for an empty or duplicate-free roster', () => {
    expect(countDuplicateTitlesByDomain([])).toBe(0)
    expect(countDuplicateTitlesByDomain([{ domainId: 'medical', title: 'Hypertension' }])).toBe(0)
  })
})

describe('titlesLikelyOverlap', () => {
  it('flags titles sharing most of their significant words', () => {
    expect(titlesLikelyOverlap('Type 2 Diabetes Management', 'Managing Type 2 Diabetes')).toBe(true)
  })

  it('does not flag distinct titles sharing only one common word', () => {
    expect(titlesLikelyOverlap('Diabetes Overview', 'Asthma Overview')).toBe(false)
  })
})

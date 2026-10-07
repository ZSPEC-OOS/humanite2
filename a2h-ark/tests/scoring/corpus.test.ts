import { describe, it, expect } from 'vitest'
import {
  toleranceFor, isWithinTolerance, wordCount, sourceDocId, sourceCellKey, topicDisplayCode, validateProjectName, validateDomains,
  validateTopicCountDefault, validateTopicCountOverrides, validateLengthLadder, resolveTopicCountByDomain, parseTopicInput,
  parseTopicPatch, checkNewTopicAgainstSiblings, checkTopicTitleChange,
} from '../../src/scoring/corpus'

describe('word-count tolerance', () => {
  it('bands', () => {
    expect([100, 300, 500, 1000, 1250, 2000].map(toleranceFor)).toEqual([0.05, 0.05, 0.04, 0.04, 0.03, 0.03])
  })
  it('acceptance', () => {
    expect(isWithinTolerance(100, 105)).toBe(true)
    expect(isWithinTolerance(100, 106)).toBe(false)
    expect(isWithinTolerance(2000, 1940)).toBe(true)
    expect(isWithinTolerance(2000, 1939)).toBe(false)
  })
  it('wordCount', () => {
    expect(wordCount('  a  b\nc ')).toBe(3)
    expect(wordCount('   ')).toBe(0)
  })
})

describe('ids', () => {
  it('formats', () => {
    expect(sourceDocId('p1', 't1', 500)).toBe('p1__t1__500')
    expect(sourceCellKey('t1', 500)).toBe('t1__500')
    expect(topicDisplayCode('medical', 3)).toBe('MED-03')
    expect(topicDisplayCode('legal', 12)).toBe('LEG-12')
  })
})

describe('project validators', () => {
  it('name', () => {
    expect(validateProjectName('')).not.toBeNull()
    expect(validateProjectName('x'.repeat(201))).not.toBeNull()
    expect(validateProjectName('ok')).toBeNull()
  })
  it('domains dedupe and reject unknown', () => {
    expect(validateDomains(['legal', 'legal'])).toEqual({ domains: ['legal'] })
    expect('error' in validateDomains(['x'])).toBe(true)
    expect('error' in validateDomains([])).toBe(true)
  })
  it('counts', () => {
    expect(validateTopicCountDefault('20')).toEqual({ topicCountDefault: 20 })
    expect('error' in validateTopicCountDefault(51)).toBe(true)
    expect(validateTopicCountOverrides({ legal: 5 }, ['legal'])).toEqual({ topicCountOverrides: { legal: 5 } })
    expect('error' in validateTopicCountOverrides({ legal: 5 }, ['medical'])).toBe(true)
    expect(resolveTopicCountByDomain(['legal', 'medical'], 20, { legal: 5 })).toEqual({ legal: 5, medical: 20 })
  })
  it('ladder', () => {
    expect(validateLengthLadder([300, 100])).toEqual({ lengthLadder: [100, 300] })
    expect('error' in validateLengthLadder([100, 100])).toBe(true)
    expect('error' in validateLengthLadder([0])).toBe(true)
  })
})

describe('topics', () => {
  const body = { domainId: 'legal', topicNumber: 2, title: ' T ', description: 'd', intendedAudience: 'a', writingType: 'w', coreConcepts: [' x ', '', 3], generationPromptVersion: 'GEN-V001' }
  it('parseTopicInput', () => {
    const r = parseTopicInput(body)
    expect('input' in r && r.input.coreConcepts).toEqual(['x'])
    expect('input' in r && r.input.title).toBe('T')
    expect('error' in parseTopicInput({ ...body, topicNumber: 0 })).toBe(true)
    expect('error' in parseTopicInput({ ...body, coreConcepts: [] })).toBe(true)
  })
  it('parseTopicPatch', () => {
    expect(parseTopicPatch({ title: ' a ', enabled: false, bogus: 1 })).toEqual({ title: 'a', enabled: false })
  })
  it('sibling checks', () => {
    const sibs = [{ id: 'a', topicNumber: 1, title: 'Hypertension' }]
    expect(checkNewTopicAgainstSiblings({ domainId: 'medical', topicNumber: 1, title: 'x' }, sibs)).toMatch(/already used/)
    expect(checkNewTopicAgainstSiblings({ domainId: 'medical', topicNumber: 2, title: 'hypertension.' }, sibs)).toMatch(/already exists/)
    expect(checkNewTopicAgainstSiblings({ domainId: 'medical', topicNumber: 2, title: 'Asthma' }, sibs)).toBeNull()
    expect(checkTopicTitleChange({ id: 'a', domainId: 'medical' }, 'Hypertension', sibs)).toBeNull()
    expect(checkTopicTitleChange({ id: 'b', domainId: 'medical' }, 'hypertension', sibs)).toMatch(/already exists/)
  })
})

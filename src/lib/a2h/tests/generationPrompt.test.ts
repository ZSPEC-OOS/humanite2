import { describe, it, expect } from 'vitest'
import { buildGenerationPrompt, maxTokensFor } from '../generationPrompt'
import type { BenchmarkTopic } from '../types'

const TOPIC: BenchmarkTopic = {
  id: 'topic-1',
  domainId: 'medical',
  topicNumber: 3,
  title: 'Managing Type 2 Diabetes',
  description: 'An overview of lifestyle and pharmacological management.',
  intendedAudience: 'Newly diagnosed adult patients',
  writingType: 'patient education handout',
  coreConcepts: ['blood glucose monitoring', 'metformin', 'dietary changes'],
  generationPromptVersion: 'GEN-V001',
  enabled: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

describe('buildGenerationPrompt', () => {
  it('includes the target word count, topic fields, and core concepts', () => {
    const prompt = buildGenerationPrompt(TOPIC, 500)
    expect(prompt).toContain('500 words')
    expect(prompt).toContain(TOPIC.title)
    expect(prompt).toContain(TOPIC.description)
    expect(prompt).toContain(TOPIC.intendedAudience)
    expect(prompt).toContain(TOPIC.writingType)
    for (const concept of TOPIC.coreConcepts) {
      expect(prompt).toContain(concept)
    }
  })

  it('instructs against truncation/padding, per the spec\'s "do not truncate" rule', () => {
    const prompt = buildGenerationPrompt(TOPIC, 2000)
    expect(prompt.toLowerCase()).toMatch(/do not write a longer piece and cut it short/)
    expect(prompt.toLowerCase()).toMatch(/do not pad a shorter piece/)
  })
})

describe('maxTokensFor', () => {
  it('scales with target word count', () => {
    expect(maxTokensFor(1000)).toBeGreaterThan(maxTokensFor(100))
  })

  it('is capped at 4096 even for the longest target', () => {
    expect(maxTokensFor(2000)).toBeLessThanOrEqual(4096)
  })
})

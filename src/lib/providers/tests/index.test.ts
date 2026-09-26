import { describe, it, expect } from 'vitest'
import {
  resolveCapabilities, OPENAI_CAPABILITIES, OPENROUTER_CAPABILITIES, DEEPSEEK_CAPABILITIES,
  GROQ_CAPABILITIES, MISTRAL_CAPABILITIES, ANTHROPIC_CAPABILITIES, GENERIC_CAPABILITIES,
} from '../index'

describe('resolveCapabilities', () => {
  it('treats a missing baseURL as the deployment\'s own default OpenAI endpoint', () => {
    expect(resolveCapabilities(undefined)).toBe(OPENAI_CAPABILITIES)
    expect(resolveCapabilities(null)).toBe(OPENAI_CAPABILITIES)
    expect(resolveCapabilities('')).toBe(OPENAI_CAPABILITIES)
  })

  it.each([
    ['https://api.openai.com/v1', OPENAI_CAPABILITIES],
    ['https://openrouter.ai/api/v1', OPENROUTER_CAPABILITIES],
    ['https://api.deepseek.com/v1', DEEPSEEK_CAPABILITIES],
    ['https://api.groq.com/openai/v1', GROQ_CAPABILITIES],
    ['https://api.mistral.ai/v1', MISTRAL_CAPABILITIES],
    ['https://api.anthropic.com/v1', ANTHROPIC_CAPABILITIES],
  ])('resolves %s to its own named adapter', (baseURL, expected) => {
    expect(resolveCapabilities(baseURL)).toBe(expected)
  })

  it('is case-insensitive on hostname', () => {
    expect(resolveCapabilities('https://API.OPENAI.COM/v1')).toBe(OPENAI_CAPABILITIES)
  })

  it('falls back to GENERIC_CAPABILITIES for an allowlisted host with no named adapter', () => {
    expect(resolveCapabilities('https://api.together.xyz/v1')).toBe(GENERIC_CAPABILITIES)
    expect(resolveCapabilities('https://api.fireworks.ai/v1')).toBe(GENERIC_CAPABILITIES)
    expect(resolveCapabilities('https://api.perplexity.ai/v1')).toBe(GENERIC_CAPABILITIES)
  })

  it('falls back to GENERIC_CAPABILITIES rather than throwing on an unparseable URL', () => {
    expect(resolveCapabilities('not a url')).toBe(GENERIC_CAPABILITIES)
  })

  it('never marks embeddings true without a matching embeddingModel, and never marks it false with one', () => {
    for (const capabilities of [OPENAI_CAPABILITIES, OPENROUTER_CAPABILITIES, DEEPSEEK_CAPABILITIES, GROQ_CAPABILITIES, MISTRAL_CAPABILITIES, ANTHROPIC_CAPABILITIES, GENERIC_CAPABILITIES]) {
      expect(capabilities.embeddings).toBe(capabilities.embeddingModel != null)
    }
  })
})

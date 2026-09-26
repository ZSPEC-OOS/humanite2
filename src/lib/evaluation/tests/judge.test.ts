import { describe, it, expect, vi } from 'vitest'
import type OpenAI from 'openai'
import { runStructuredJudge } from '../judge'

function mockChatClient(content: string) {
  const create = vi.fn().mockResolvedValue({
    model: 'gpt-4o-mini',
    choices: [{ message: { content } }],
  })
  return { client: { chat: { completions: { create } } } as unknown as OpenAI, create }
}

describe('runStructuredJudge', () => {
  it('parses every dimension from a single well-formed judgment', async () => {
    const { client } = mockChatClient(JSON.stringify({
      entailment_probability: 0.9,
      entailment_issues: ['minor rewording risk'],
      tone_alignment: 0.8,
      domain_alignment: 0.7,
      coherence: 0.85,
      naturalness: 0.6,
      style_issues: ['slightly stiff phrasing'],
    }))

    const result = await runStructuredJudge(client, 'gpt-4o-mini', 'orig', 'out', 'casual', 'general')

    expect(result).toEqual({
      entailment_probability: 0.9,
      entailment_issues: ['minor rewording risk'],
      tone_alignment: 0.8,
      domain_alignment: 0.7,
      coherence: 0.85,
      naturalness: 0.6,
      style_issues: ['slightly stiff phrasing'],
    })
  })

  it('sends one combined call requesting all four judgments, not one per dimension', async () => {
    const { client, create } = mockChatClient('{}')
    await runStructuredJudge(client, 'gpt-4o-mini', 'orig', 'out', 'casual', 'general')
    expect(create).toHaveBeenCalledTimes(1)
    const prompt = create.mock.calls[0]![0].messages[0].content as string
    expect(prompt).toContain('casual')
    expect(prompt).toContain('general')
  })

  it('clamps every score into [0, 1]', async () => {
    const { client } = mockChatClient(JSON.stringify({
      entailment_probability: 1.5,
      tone_alignment: -0.3,
      domain_alignment: 2,
      coherence: -1,
      naturalness: 1.1,
    }))
    const result = await runStructuredJudge(client, 'gpt-4o-mini', 'orig', 'out', 'casual', 'general')
    expect(result.entailment_probability).toBe(1)
    expect(result.tone_alignment).toBe(0)
    expect(result.domain_alignment).toBe(1)
    expect(result.coherence).toBe(0)
    expect(result.naturalness).toBe(1)
  })

  it('defaults every field to a safe empty/zero value on malformed content, rather than throwing', async () => {
    const { client } = mockChatClient('not valid json {{{')
    await expect(runStructuredJudge(client, 'gpt-4o-mini', 'orig', 'out', 'casual', 'general')).rejects.toThrow()
  })

  it('tolerates missing issue arrays, defaulting to empty rather than undefined', async () => {
    const { client } = mockChatClient(JSON.stringify({ entailment_probability: 1, tone_alignment: 1, domain_alignment: 1, coherence: 1, naturalness: 1 }))
    const result = await runStructuredJudge(client, 'gpt-4o-mini', 'orig', 'out', 'casual', 'general')
    expect(result.entailment_issues).toEqual([])
    expect(result.style_issues).toEqual([])
  })

  it('caps each issues array at 10 entries', async () => {
    const manyIssues = Array.from({ length: 15 }, (_, i) => `issue ${i}`)
    const { client } = mockChatClient(JSON.stringify({ entailment_probability: 1, entailment_issues: manyIssues, style_issues: manyIssues }))
    const result = await runStructuredJudge(client, 'gpt-4o-mini', 'orig', 'out', 'casual', 'general')
    expect(result.entailment_issues).toHaveLength(10)
    expect(result.style_issues).toHaveLength(10)
  })
})

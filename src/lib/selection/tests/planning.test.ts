import { describe, it, expect, vi } from 'vitest'
import type OpenAI from 'openai'
import { buildRewritePlan, buildPlanSection } from '../planning'

function mockClient(content: string) {
  const create = vi.fn().mockResolvedValue({ model: 'gpt-4o-mini', choices: [{ message: { content } }] })
  return { client: { chat: { completions: { create } } } as unknown as OpenAI, create }
}

describe('buildRewritePlan', () => {
  it('makes exactly one call and parses the operations list', async () => {
    const { client, create } = mockClient(JSON.stringify({ operations: ['merge sentences 1 and 2', 'split the final sentence'] }))
    const plan = await buildRewritePlan(client, 'gpt-4o-mini', 'Some source text. Another sentence.')
    expect(create).toHaveBeenCalledTimes(1)
    expect(plan.operations).toEqual(['merge sentences 1 and 2', 'split the final sentence'])
  })

  it('returns an empty plan rather than throwing when the model proposes nothing', async () => {
    const { client } = mockClient('{"operations": []}')
    const plan = await buildRewritePlan(client, 'gpt-4o-mini', 'Already well-structured text.')
    expect(plan.operations).toEqual([])
  })

  it('caps operations at 6 even if the model returns more', async () => {
    const { client } = mockClient(JSON.stringify({ operations: Array.from({ length: 10 }, (_, i) => `op ${i}`) }))
    const plan = await buildRewritePlan(client, 'gpt-4o-mini', 'text')
    expect(plan.operations).toHaveLength(6)
  })

  it('rejects on malformed JSON rather than silently returning an empty plan', async () => {
    const { client } = mockClient('not valid json {{{')
    await expect(buildRewritePlan(client, 'gpt-4o-mini', 'text')).rejects.toThrow()
  })
})

describe('buildPlanSection', () => {
  it('renders an empty string for an empty plan — no heading with nothing under it', () => {
    expect(buildPlanSection({ operations: [] })).toBe('')
  })

  it('renders each operation as a bullet under a shared heading', () => {
    const section = buildPlanSection({ operations: ['merge sentences 1 and 2', 'split the final sentence'] })
    expect(section).toContain('STRUCTURAL PLAN')
    expect(section).toContain('- merge sentences 1 and 2')
    expect(section).toContain('- split the final sentence')
  })
})

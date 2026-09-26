import { describe, it, expect, vi } from 'vitest'
import type OpenAI from 'openai'
import { restoreRelations } from '../repair'
import type { ClaimVerdict } from '../types'

function mockClient(...completions: string[]) {
  const create = vi.fn()
  for (const content of completions) {
    create.mockResolvedValueOnce({ model: 'gpt-4o-mini', choices: [{ message: { content } }] })
  }
  return { client: { chat: { completions: { create } } } as unknown as OpenAI, create }
}

function verdict(overrides: Partial<ClaimVerdict> = {}): ClaimVerdict {
  return {
    claim: { subject: 'the company', predicate: 'increased', object: 'hiring', qualifiers: [], polarity: 'affirmative', modality: null },
    entailed: false,
    reason: 'causal direction reversed',
    outputSentenceIndex: 0,
    ...overrides,
  }
}

describe('restoreRelations', () => {
  it('does nothing and makes no API call when there are no failures with a localized sentence', async () => {
    const { client, create } = mockClient()
    const result = await restoreRelations(client, 'gpt-4o-mini', 'source.', 'output.', [verdict({ outputSentenceIndex: null })], 'balanced', 'general')
    expect(result.attempted).toBe(false)
    expect(result.strategy).toBe('none')
    expect(create).not.toHaveBeenCalled()
  })

  it('repairs a single localized sentence, leaving the rest of the text untouched', async () => {
    const source = 'Because sales grew sharply, the company increased hiring across every region.'
    const corrupted = 'Because the company increased hiring across every region, sales grew sharply. Costs stayed flat.'
    const { client } = mockClient('Because sales grew sharply, the company increased hiring across every region.')

    const result = await restoreRelations(client, 'gpt-4o-mini', source, corrupted, [verdict()], 'balanced', 'business')

    expect(result.attempted).toBe(true)
    expect(result.strategy).toBe('restore_relations')
    expect(result.succeeded).toBe(true)
    expect(result.sentencesRepaired).toBe(1)
    expect(result.text).toContain('Because sales grew sharply, the company increased hiring across every region.')
    expect(result.text).toContain('Costs stayed flat.')
  })

  it('merges two failing claims that localize to the same sentence into a single repair call', async () => {
    const { client, create } = mockClient('A single corrected sentence.')
    const failures = [
      verdict({ outputSentenceIndex: 0, reason: 'first problem' }),
      verdict({ outputSentenceIndex: 0, reason: 'second problem' }),
    ]
    await restoreRelations(client, 'gpt-4o-mini', 'source.', 'One sentence here.', failures, 'balanced', 'general')
    expect(create).toHaveBeenCalledTimes(1)
    const prompt = create.mock.calls[0]![0].messages[1].content as string
    expect(prompt).toContain('first problem')
    expect(prompt).toContain('second problem')
  })

  it('reports unsucceeded when the model returns an empty completion', async () => {
    const { client } = mockClient('')
    const result = await restoreRelations(client, 'gpt-4o-mini', 'source.', 'One sentence here.', [verdict()], 'balanced', 'general')
    expect(result.succeeded).toBe(false)
    expect(result.text).toBe('One sentence here.')
  })
})

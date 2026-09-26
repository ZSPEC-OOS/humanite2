import { describe, it, expect, vi } from 'vitest'
import type OpenAI from 'openai'
import { runDocumentConsistencyPass } from '../orchestrate'
import { emptyDocumentContext } from '../analysis'

function mockClient(...completions: string[]) {
  const create = vi.fn()
  for (const content of completions) {
    create.mockResolvedValueOnce({ model: 'gpt-4o-mini', choices: [{ message: { content } }] })
  }
  return { client: { chat: { completions: { create } } } as unknown as OpenAI, create }
}

describe('runDocumentConsistencyPass', () => {
  it('reports perfect consistency and makes no repair call when there is nothing to fix', async () => {
    const { client, create } = mockClient()
    const context = emptyDocumentContext()
    const result = await runDocumentConsistencyPass(client, 'gpt-4o-mini', 'Some finished output.', context, ['Some finished output.'])

    expect(create).not.toHaveBeenCalled()
    expect(result.text).toBe('Some finished output.')
    expect(result.terminologyConsistency).toBe(1)
    expect(result.terminologyViolations).toEqual([])
    expect(result.terminologyRepair).toEqual({ attempted: false, succeeded: false, sentencesRepaired: 0 })
    expect(result.toneDriftedChunkIndexes).toEqual([])
  })

  it('detects a terminology violation, repairs it, and returns the repaired text', async () => {
    const { client } = mockClient('The Company filed its report.')
    const context = { ...emptyDocumentContext(), terminology: { 'the Corporation': 'the Company' } }
    const postText = 'The Corporation filed its report.'

    const result = await runDocumentConsistencyPass(client, 'gpt-4o-mini', postText, context, [postText])

    expect(result.terminologyViolations).toHaveLength(1)
    expect(result.terminologyRepair.attempted).toBe(true)
    expect(result.terminologyRepair.succeeded).toBe(true)
    expect(result.text).toBe('The Company filed its report.')
  })

  it('falls back to the pre-repair text when the repair call itself fails', async () => {
    const create = vi.fn().mockRejectedValueOnce(new Error('upstream failure'))
    const client = { chat: { completions: { create } } } as unknown as OpenAI
    const context = { ...emptyDocumentContext(), terminology: { 'the Corporation': 'the Company' } }
    const postText = 'The Corporation filed its report.'

    const result = await runDocumentConsistencyPass(client, 'gpt-4o-mini', postText, context, [postText])

    expect(result.terminologyRepair).toEqual({ attempted: false, succeeded: false, sentencesRepaired: 0 })
    expect(result.text).toBe(postText)
  })

  it('flags drifted chunks using tone drift detection across the given chunk texts', async () => {
    const { client } = mockClient()
    const context = emptyDocumentContext()
    const formalChunk = 'The organization shall not proceed without approval. It is required. It is expected.'
    const casualChunks = [
      "It's fine, isn't it? We're good. It's all set. Don't worry.",
      "It's great, isn't it? We're happy. It's a wrap. Don't stress.",
    ]
    const chunkTexts = [formalChunk, ...casualChunks]
    const postText = chunkTexts.join(' ')

    const result = await runDocumentConsistencyPass(client, 'gpt-4o-mini', postText, context, chunkTexts)

    expect(result.toneDriftedChunkIndexes).toContain(0)
    expect(result.toneDriftedChunkCount).toBeGreaterThan(0)
  })
})

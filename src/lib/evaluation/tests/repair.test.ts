import { describe, it, expect, vi } from 'vitest'
import type OpenAI from 'openai'
import { classifyFailure, repairChunk, repairGrammar } from '../repair'
import { validateFactLedger } from '@/lib/fidelity'

function mockRepairClient(...completions: Array<string | { content: string; usage?: { prompt_tokens: number; completion_tokens: number } }>) {
  const create = vi.fn()
  for (const c of completions) {
    const content = typeof c === 'string' ? c : c.content
    const usage = typeof c === 'string' ? undefined : c.usage
    create.mockResolvedValueOnce({ model: 'gpt-4o-mini', choices: [{ message: { content } }], usage })
  }
  return { client: { chat: { completions: { create } } } as unknown as OpenAI, create }
}

describe('classifyFailure', () => {
  it('classifies as sentence_repair when at least one failure has an aligned output sentence', () => {
    const { failures } = validateFactLedger('The dose is 5 mg.', 'The dose is 50 mg.')
    const strategy = classifyFailure(failures, new Set([0]))
    expect(strategy).toBe('sentence_repair')
  })

  it('classifies as none when no failure has an aligned output sentence to target', () => {
    const { failures } = validateFactLedger('The dose is 5 mg.', 'The dose is 50 mg.')
    const strategy = classifyFailure(failures, new Set())
    expect(strategy).toBe('none')
  })
})

describe('repairChunk', () => {
  it('does nothing and makes no API call when the output already passes fidelity validation', async () => {
    const { client, create } = mockRepairClient()
    const text = 'The dose is 5 mg, and it must not exceed 20 mg per day.'
    const result = await repairChunk(client, 'gpt-4o-mini', text, text, 'balanced', 'medical')
    expect(result.attempted).toBe(false)
    expect(result.strategy).toBe('none')
    expect(create).not.toHaveBeenCalled()
  })

  it('repairs a single failing sentence while leaving the rest of the text untouched', async () => {
    const source = 'The dose is 5 mg. The trial had 40 patients.'
    const corrupted = 'The dose is 50 mg. The trial had 40 patients.'
    const { client } = mockRepairClient('The dose is 5 mg.')

    const result = await repairChunk(client, 'gpt-4o-mini', source, corrupted, 'balanced', 'medical')

    expect(result.attempted).toBe(true)
    expect(result.strategy).toBe('sentence_repair')
    expect(result.succeeded).toBe(true)
    expect(result.sentencesRepaired).toBe(1)
    expect(result.text).toBe('The dose is 5 mg. The trial had 40 patients.')
  })

  it('binds two facts swapped between entities into a single repaired sentence, not two separate calls', async () => {
    const source = 'Server Alpha runs firmware 2.1; Server Beta runs firmware 3.4.'
    const corrupted = 'Server Alpha runs firmware 3.4; Server Beta runs firmware 2.1.'
    const { client, create } = mockRepairClient('Server Alpha runs firmware 2.1; Server Beta runs firmware 3.4.')

    const result = await repairChunk(client, 'gpt-4o-mini', source, corrupted, 'balanced', 'technical')

    expect(create).toHaveBeenCalledTimes(1)
    expect(result.succeeded).toBe(true)
    expect(result.text).toBe(source)
  })

  it('never ships a repair that does not actually fix the problem, and reports it as failed', async () => {
    const source = 'The dose is 5 mg. The trial had 40 patients.'
    const corrupted = 'The dose is 50 mg. The trial had 40 patients.'
    // The model's "fix" still doesn't include the required "5 mg".
    const { client } = mockRepairClient('The dose is still not quite right.')

    const result = await repairChunk(client, 'gpt-4o-mini', source, corrupted, 'balanced', 'medical')

    expect(result.succeeded).toBe(false)
    expect(result.text).toBe(corrupted)
  })

  it('reports unrepaired when the failing fact has no aligned output sentence at all', async () => {
    const source = 'The dose is 5 mg.'
    const corrupted = 'Administer the standard dose to the patient as directed by staff.'
    const { client, create } = mockRepairClient()

    const result = await repairChunk(client, 'gpt-4o-mini', source, corrupted, 'balanced', 'medical')

    expect(result.attempted).toBe(false)
    expect(result.strategy).toBe('none')
    expect(create).not.toHaveBeenCalled()
  })

  it('reports zero calls and null tokens when it never attempts a repair (Phase 5 telemetry)', async () => {
    const text = 'The dose is 5 mg, and it must not exceed 20 mg per day.'
    const { client } = mockRepairClient()
    const result = await repairChunk(client, 'gpt-4o-mini', text, text, 'balanced', 'medical')
    expect(result.modelCalls).toBe(0)
    expect(result.inputTokens).toBeNull()
    expect(result.outputTokens).toBeNull()
  })

  it('counts modelCalls and null tokens when the provider reports no usage (Phase 5 telemetry)', async () => {
    const source = 'The dose is 5 mg. The trial had 40 patients.'
    const corrupted = 'The dose is 50 mg. The trial had 40 patients.'
    const { client } = mockRepairClient('The dose is 5 mg.')
    const result = await repairChunk(client, 'gpt-4o-mini', source, corrupted, 'balanced', 'medical')
    expect(result.modelCalls).toBe(1)
    expect(result.inputTokens).toBeNull()
    expect(result.outputTokens).toBeNull()
  })

  it('does not throw and still attempts every flagged sentence when one sentence\'s repair call rejects (deep-audit regression)', async () => {
    // Each flagged sentence's repair runs independently and concurrently
    // (Promise.allSettled) — previously, a sequential loop would throw on
    // the first rejection, propagate out of repairChunk uncaught, and never
    // even attempt the second sentence's repair. (repairChunk's own final
    // document-level re-verification still correctly reports `succeeded:
    // false` here, since the un-repaired sentence's fact is still missing —
    // that gate is unrelated to this fix; see the test above for the "every
    // repaired sentence must actually fix the document" behavior.)
    const source = 'The dose is 5 mg. The trial had 40 patients.'
    const corrupted = 'The dose is 50 mg. The trial had 4 patients.'
    const create = vi.fn()
      .mockRejectedValueOnce(new Error('rate limited'))
      .mockResolvedValueOnce({ model: 'gpt-4o-mini', choices: [{ message: { content: 'The trial had 40 patients.' } }] })
    const client = { chat: { completions: { create } } } as unknown as OpenAI

    const result = await repairChunk(client, 'gpt-4o-mini', source, corrupted, 'balanced', 'medical')
    expect(result.modelCalls).toBe(2)
  })

  it('sums real token usage across repaired sentences when the provider reports it (Phase 5 telemetry)', async () => {
    const source = 'Server Alpha runs firmware 2.1; Server Beta runs firmware 3.4.'
    const corrupted = 'Server Alpha runs firmware 3.4; Server Beta runs firmware 2.1.'
    const { client } = mockRepairClient({ content: 'Server Alpha runs firmware 2.1; Server Beta runs firmware 3.4.', usage: { prompt_tokens: 150, completion_tokens: 30 } })
    const result = await repairChunk(client, 'gpt-4o-mini', source, corrupted, 'balanced', 'technical')
    expect(result.modelCalls).toBe(1)
    expect(result.inputTokens).toBe(150)
    expect(result.outputTokens).toBe(30)
  })
})

describe('repairGrammar', () => {
  it('returns the corrected text and real token usage when the provider reports it', async () => {
    const { client } = mockRepairClient({ content: 'A pathogen enters the bloodstream.', usage: { prompt_tokens: 80, completion_tokens: 12 } })
    const result = await repairGrammar(client, 'gpt-4o-mini', 'A pathogen enter the bloodstream.')
    expect(result.text).toBe('A pathogen enters the bloodstream.')
    expect(result.inputTokens).toBe(80)
    expect(result.outputTokens).toBe(12)
  })

  it('reports null tokens (not fabricated) when the provider omits usage', async () => {
    const { client } = mockRepairClient('A pathogen enters the bloodstream.')
    const result = await repairGrammar(client, 'gpt-4o-mini', 'A pathogen enter the bloodstream.')
    expect(result.inputTokens).toBeNull()
    expect(result.outputTokens).toBeNull()
  })
})

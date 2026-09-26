import { describe, it, expect, vi } from 'vitest'
import type OpenAI from 'openai'
import { classifyFailure, repairChunk } from '../repair'
import { validateFactLedger } from '@/lib/fidelity'

function mockRepairClient(...completions: string[]) {
  const create = vi.fn()
  for (const content of completions) {
    create.mockResolvedValueOnce({ model: 'gpt-4o-mini', choices: [{ message: { content } }] })
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
})

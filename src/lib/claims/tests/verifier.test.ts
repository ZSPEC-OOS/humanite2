import { describe, it, expect, vi } from 'vitest'
import type OpenAI from 'openai'
import { verifyClaims } from '../verifier'

function mockClient(content: string) {
  const create = vi.fn().mockResolvedValue({ model: 'gpt-4o-mini', choices: [{ message: { content } }] })
  return { client: { chat: { completions: { create } } } as unknown as OpenAI, create }
}

describe('verifyClaims', () => {
  it('makes exactly one call regardless of how many claims it extracts', async () => {
    const { client, create } = mockClient('{"claims": []}')
    await verifyClaims(client, 'gpt-4o-mini', 'source text.', 'output text.')
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('passes when every extracted claim is entailed', async () => {
    const { client } = mockClient(JSON.stringify({
      claims: [
        { subject: 'sales', predicate: 'grew', object: 'sharply', qualifiers: [], polarity: 'affirmative', modality: null, entailed: true, reason: '', output_sentence_index: null },
      ],
    }))
    const result = await verifyClaims(client, 'gpt-4o-mini', 'Sales grew sharply.', 'Sales grew sharply.')
    expect(result.passed).toBe(true)
    expect(result.claimCount).toBe(1)
    expect(result.failures).toHaveLength(0)
  })

  it('fails and reports the reason and localized sentence when a claim is not entailed', async () => {
    const { client } = mockClient(JSON.stringify({
      claims: [
        {
          subject: 'the company', predicate: 'increased', object: 'hiring', qualifiers: ['across every region'],
          polarity: 'affirmative', modality: null, entailed: false,
          reason: 'causal direction reversed', output_sentence_index: 0,
        },
      ],
    }))
    const result = await verifyClaims(client, 'gpt-4o-mini', 'src', 'Because the company increased hiring, sales grew.')
    expect(result.passed).toBe(false)
    expect(result.failures).toHaveLength(1)
    expect(result.failures[0]!.reason).toBe('causal direction reversed')
    expect(result.failures[0]!.outputSentenceIndex).toBe(0)
    expect(result.failures[0]!.claim.qualifiers).toEqual(['across every region'])
  })

  it('includes the covered-facts list in the prompt so the model can skip them', async () => {
    const { client, create } = mockClient('{"claims": []}')
    await verifyClaims(client, 'gpt-4o-mini', 'src', 'out', ['5 mg', '2024'])
    const prompt = create.mock.calls[0]![0].messages[0].content as string
    expect(prompt).toContain('5 mg')
    expect(prompt).toContain('2024')
  })

  it('numbers the output sentences in the prompt so the model can localize a failure', async () => {
    const { client, create } = mockClient('{"claims": []}')
    await verifyClaims(client, 'gpt-4o-mini', 'src', 'First sentence. Second sentence.')
    const prompt = create.mock.calls[0]![0].messages[0].content as string
    expect(prompt).toContain('0: First sentence.')
    expect(prompt).toContain('1: Second sentence.')
  })

  it('discards an out-of-range or non-integer sentence index rather than trusting it blindly', async () => {
    const { client } = mockClient(JSON.stringify({
      claims: [
        { subject: 's', predicate: 'p', object: 'o', qualifiers: [], polarity: 'affirmative', modality: null, entailed: false, reason: 'bad', output_sentence_index: 99 },
      ],
    }))
    const result = await verifyClaims(client, 'gpt-4o-mini', 'src', 'Only one sentence.')
    expect(result.failures[0]!.outputSentenceIndex).toBeNull()
  })

  it('caps extracted claims at 12 even if the model returns more', async () => {
    const claims = Array.from({ length: 20 }, (_, i) => ({
      subject: `s${i}`, predicate: 'p', object: 'o', qualifiers: [], polarity: 'affirmative', modality: null, entailed: true, reason: '', output_sentence_index: null,
    }))
    const { client } = mockClient(JSON.stringify({ claims }))
    const result = await verifyClaims(client, 'gpt-4o-mini', 'src', 'out')
    expect(result.claimCount).toBe(12)
  })

  it('rejects on malformed JSON rather than silently reporting a false pass', async () => {
    const { client } = mockClient('not valid json {{{')
    await expect(verifyClaims(client, 'gpt-4o-mini', 'src', 'out')).rejects.toThrow()
  })

  it('passes trivially (no claims, no failures) when nothing gets extracted', async () => {
    const { client } = mockClient('{"claims": []}')
    const result = await verifyClaims(client, 'gpt-4o-mini', 'src', 'out')
    expect(result.passed).toBe(true)
    expect(result.claimCount).toBe(0)
  })
})

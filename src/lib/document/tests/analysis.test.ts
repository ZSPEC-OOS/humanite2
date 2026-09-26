import { describe, it, expect, vi } from 'vitest'
import type OpenAI from 'openai'
import { buildDocumentContext, emptyDocumentContext } from '../analysis'

function mockClient(content: string) {
  const create = vi.fn().mockResolvedValue({ model: 'gpt-4o-mini', choices: [{ message: { content } }] })
  return { client: { chat: { completions: { create } } } as unknown as OpenAI, create }
}

describe('buildDocumentContext', () => {
  it('makes exactly one call and parses terminology/abbreviations/section summaries', async () => {
    const { client, create } = mockClient(JSON.stringify({
      terminology: { 'the Corporation': 'the Company' },
      abbreviations: { API: 'Application Programming Interface' },
      section_summaries: ['Introduces the company.', 'Describes the API.'],
    }))

    const context = await buildDocumentContext(client, 'gpt-4o-mini', 'source text', 'report', 'executive')

    expect(create).toHaveBeenCalledTimes(1)
    expect(context.genre).toBe('report')
    expect(context.audience).toBe('executive')
    expect(context.terminology).toEqual({ 'the Corporation': 'the Company' })
    expect(context.abbreviations).toEqual({ API: 'Application Programming Interface' })
    expect(context.sectionSummaries).toEqual(['Introduces the company.', 'Describes the API.'])
  })

  it('carries a null genre/audience through unchanged when neither was selected', async () => {
    const { client } = mockClient('{}')
    const context = await buildDocumentContext(client, 'gpt-4o-mini', 'source text', null, null)
    expect(context.genre).toBeNull()
    expect(context.audience).toBeNull()
  })

  it('returns empty maps rather than throwing when the model reports nothing', async () => {
    const { client } = mockClient('{"terminology": {}, "abbreviations": {}, "section_summaries": []}')
    const context = await buildDocumentContext(client, 'gpt-4o-mini', 'source text', null, null)
    expect(context.terminology).toEqual({})
    expect(context.abbreviations).toEqual({})
    expect(context.sectionSummaries).toEqual([])
  })

  it('discards a malformed entry (non-string key or value) rather than propagating it', async () => {
    const { client } = mockClient(JSON.stringify({
      terminology: { 'valid': 'ok', '': 'blank key', 'bad value': 42 },
    }))
    const context = await buildDocumentContext(client, 'gpt-4o-mini', 'source text', null, null)
    expect(context.terminology).toEqual({ valid: 'ok' })
  })

  it('rejects on malformed JSON rather than silently returning an empty context', async () => {
    const { client } = mockClient('not valid json {{{')
    await expect(buildDocumentContext(client, 'gpt-4o-mini', 'source text', null, null)).rejects.toThrow()
  })

  it('includes the genre/audience in the prompt when selected', async () => {
    const { client, create } = mockClient('{}')
    await buildDocumentContext(client, 'gpt-4o-mini', 'source text', 'patient_instructions', 'patient')
    const prompt = create.mock.calls[0]![0].messages[0].content as string
    expect(prompt).toContain('patient_instructions')
    expect(prompt).toContain('patient')
  })
})

describe('emptyDocumentContext', () => {
  it('carries no terminology, abbreviations, or summaries', () => {
    const context = emptyDocumentContext()
    expect(context.genre).toBeNull()
    expect(context.audience).toBeNull()
    expect(context.terminology).toEqual({})
    expect(context.abbreviations).toEqual({})
    expect(context.sectionSummaries).toEqual([])
  })

  it('carries a supplied genre/audience through', () => {
    const context = emptyDocumentContext('memo', 'executive')
    expect(context.genre).toBe('memo')
    expect(context.audience).toBe('executive')
  })
})

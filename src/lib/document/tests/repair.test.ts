import { describe, it, expect, vi } from 'vitest'
import type OpenAI from 'openai'
import { repairTerminologyDrift } from '../repair'
import type { TerminologyViolation } from '../consistency'

function mockClient(...completions: string[]) {
  const create = vi.fn()
  for (const content of completions) {
    create.mockResolvedValueOnce({ model: 'gpt-4o-mini', choices: [{ message: { content } }] })
  }
  return { client: { chat: { completions: { create } } } as unknown as OpenAI, create }
}

function violation(overrides: Partial<TerminologyViolation> = {}): TerminologyViolation {
  return { variant: 'the Corporation', canonical: 'the Company', count: 1, ...overrides }
}

describe('repairTerminologyDrift', () => {
  it('does nothing and makes no API call when there are no violations', async () => {
    const { client, create } = mockClient()
    const result = await repairTerminologyDrift(client, 'gpt-4o-mini', 'Some output text.', [])
    expect(result.attempted).toBe(false)
    expect(create).not.toHaveBeenCalled()
  })

  it('repairs the one sentence carrying the violation, leaving the rest untouched', async () => {
    const output = 'The Company filed its report. The Corporation later amended it. Nothing else changed.'
    const { client } = mockClient('The Company later amended it.')

    const result = await repairTerminologyDrift(client, 'gpt-4o-mini', output, [violation()])

    expect(result.attempted).toBe(true)
    expect(result.succeeded).toBe(true)
    expect(result.sentencesRepaired).toBe(1)
    expect(result.text).toBe('The Company filed its report. The Company later amended it. Nothing else changed.')
  })

  it('merges two violations in the same sentence into a single repair call', async () => {
    const output = 'The Corporation and the vendor signed the deal.'
    const { client, create } = mockClient('The Company and the Supplier signed the deal.')

    const violations: TerminologyViolation[] = [
      violation({ variant: 'the Corporation', canonical: 'the Company' }),
      violation({ variant: 'the vendor', canonical: 'the Supplier' }),
    ]
    const result = await repairTerminologyDrift(client, 'gpt-4o-mini', output, violations)

    expect(create).toHaveBeenCalledTimes(1)
    const prompt = create.mock.calls[0]![0].messages[1].content as string
    expect(prompt).toContain('Replace "the Corporation" with "the Company"')
    expect(prompt).toContain('Replace "the vendor" with "the Supplier"')
    expect(result.sentencesRepaired).toBe(1)
    expect(result.text).toBe('The Company and the Supplier signed the deal.')
  })

  it('repairs two separate sentences with two separate calls', async () => {
    const output = 'The Corporation did X. Something unrelated. The Corporation did Y.'
    const { client, create } = mockClient('The Company did X.', 'The Company did Y.')

    const result = await repairTerminologyDrift(client, 'gpt-4o-mini', output, [violation()])

    expect(create).toHaveBeenCalledTimes(2)
    expect(result.sentencesRepaired).toBe(2)
    expect(result.text).toBe('The Company did X. Something unrelated. The Company did Y.')
  })

  it('reports unsucceeded when the model returns an empty completion', async () => {
    const output = 'The Corporation filed its report.'
    const { client } = mockClient('')
    const result = await repairTerminologyDrift(client, 'gpt-4o-mini', output, [violation()])
    expect(result.succeeded).toBe(false)
    expect(result.text).toBe(output)
  })
})

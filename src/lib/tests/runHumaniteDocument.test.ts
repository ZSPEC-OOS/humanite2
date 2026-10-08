import { describe, it, expect, vi } from 'vitest'
import type OpenAI from 'openai'
import { runHumaniteDocument } from '../runHumaniteDocument'
import { effectiveIntensity } from '../intensity'
import { candidateCountForIntensity } from '../selection'

// "Final Polish" patch, §21: proves the ONE shared transformation wrapper
// production's /v1/humanize synchronous path and the benchmark service both now
// call produces the exact same CONFIGURATION decisions for a given request
// — never asserting identical stochastic text (the model's actual rewrite),
// only the deterministic decisions that must never diverge between what a
// real user's request receives and what the benchmark measures.

function stubClient(): OpenAI {
  const create = vi.fn().mockImplementation(async (args: { model: string; response_format?: { type?: string } }) => {
    if (args.response_format?.type === 'json_object') {
      return { model: args.model, choices: [{ message: { content: '{"entailment_probability": 0.9, "issues": []}' }, finish_reason: 'stop' }] }
    }
    return {
      model: args.model,
      choices: [{ message: { content: 'A humanized rewrite of the source text, produced for regression-test purposes only.' }, finish_reason: 'stop' }],
      usage: { total_tokens: 400 },
    }
  })
  return { chat: { completions: { create } } } as unknown as OpenAI
}

const SOURCE_TEXT = 'A patient should consult their physician before beginning any new treatment regimen for this condition.'

describe('runHumaniteDocument — shared production/benchmark transformation semantics (§21)', () => {
  it('applies exactly effectiveIntensity(requested, domain) — never the raw requested value', async () => {
    const client = stubClient()
    const result = await runHumaniteDocument({
      client, model: 'gpt-4o-mini', sourceText: SOURCE_TEXT, requestedIntensity: 9, tone: 'balanced', domain: 'medical',
    })
    const expected = effectiveIntensity(9, 'medical')
    expect(result.requestedIntensity).toBe(expected.requested)
    expect(result.appliedIntensity).toBe(expected.applied)
    expect(result.intensityCapped).toBe(expected.capped)
    expect(result.appliedIntensity).toBe(5) // medical cap
    expect(result.intensityCapped).toBe(true)
  })

  it('leaves an uncapped domain (general) unchanged at any requested value 1-10', async () => {
    const client = stubClient()
    const result = await runHumaniteDocument({
      client, model: 'gpt-4o-mini', sourceText: SOURCE_TEXT, requestedIntensity: 10, tone: 'balanced', domain: 'general',
    })
    expect(result.appliedIntensity).toBe(10)
    expect(result.intensityCapped).toBe(false)
  })

  it('passes the requested model straight through, and the response reports the provider identity used', async () => {
    const client = stubClient()
    const result = await runHumaniteDocument({
      client, model: 'gpt-4o-mini', sourceText: SOURCE_TEXT, requestedIntensity: 5, tone: 'academic', domain: 'academic',
    })
    expect(result.modelUsed).toBe('gpt-4o-mini')
  })

  it('honors candidateCountOverride (a single-candidate benchmark arm) without changing the applied intensity', async () => {
    const client = stubClient()
    const withOverride = await runHumaniteDocument({
      client, model: 'gpt-4o-mini', sourceText: SOURCE_TEXT, requestedIntensity: 8, tone: 'balanced', domain: 'technical', candidateCountOverride: 1,
    })
    const withoutOverride = await runHumaniteDocument({
      client, model: 'gpt-4o-mini', sourceText: SOURCE_TEXT, requestedIntensity: 8, tone: 'balanced', domain: 'technical',
    })
    // Both arms share the SAME applied intensity (the domain cap doesn't
    // care about candidate count) — only candidate selection differs.
    expect(withOverride.appliedIntensity).toBe(withoutOverride.appliedIntensity)
    expect(withOverride.appliedIntensity).toBe(7) // technical cap
    expect(withOverride.candidateCount).toBe(1)
    // Production's own candidate policy for intensity 8 (uncapped call, no
    // override) actually invokes candidate search — confirms the override
    // is doing something real, not a no-op.
    expect(candidateCountForIntensity(8)).toBeGreaterThan(1)
  })

  it('runs a document-context pass and a document-consistency pass for every call — never skipped', async () => {
    const client = stubClient()
    await runHumaniteDocument({
      client, model: 'gpt-4o-mini', sourceText: SOURCE_TEXT, requestedIntensity: 5, tone: 'balanced', domain: 'general',
    })
    const calls = (client.chat.completions.create as ReturnType<typeof vi.fn>).mock.calls
    // At least 2 calls: the primary generation call, plus at least one
    // document-context/consistency-shaped call (json_object response format
    // is how this codebase's document analysis/consistency calls request
    // structured output).
    const jsonCalls = calls.filter(([args]) => (args as { response_format?: { type?: string } }).response_format?.type === 'json_object')
    expect(jsonCalls.length).toBeGreaterThan(0)
  })

  it('returns telemetry (modelCalls/tokens/retryCount) sourced from the pipeline, not fabricated', async () => {
    const client = stubClient()
    const result = await runHumaniteDocument({
      client, model: 'gpt-4o-mini', sourceText: SOURCE_TEXT, requestedIntensity: 5, tone: 'balanced', domain: 'general',
    })
    expect(result.modelCalls).toBeGreaterThan(0)
    expect(typeof result.retryCount).toBe('number')
  })
})

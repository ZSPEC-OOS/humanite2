import { describe, it, expect } from 'vitest'
import { aggregateChunkResults, buildUserPrompt, ChunkResult } from '../humanizePipeline'
import type { QualityScores } from '../qualityGates'

describe('buildUserPrompt — vocabulary guidance', () => {
  const prompt = buildUserPrompt('some text', [], 5, 'balanced', 'general')

  it('no longer instructs a mandatory, judgment-free word swap', () => {
    expect(prompt).not.toMatch(/mandatory/i)
    expect(prompt).not.toContain('"utilize" → "use"')
  })

  it('frames vocabulary as a preference conditioned on not changing meaning', () => {
    expect(prompt).toMatch(/prefer plainer alternatives/i)
    expect(prompt).toMatch(/never make a substitution that would change/i)
  })

  it('still instructs the model to always remove AI-typical filler openers', () => {
    expect(prompt).toMatch(/always safe/i)
    expect(prompt).toContain('Furthermore,')
    expect(prompt).toContain('It is important to note that')
  })
})

function gate(overrides: Partial<QualityScores> = {}): QualityScores {
  return {
    semantic_similarity: 0.9,
    nli_entailment: 0.95,
    entity_overlap: 1,
    passed: true,
    failed_gate: null,
    missing_facts: [],
    entailment_issues: [],
    preservation_by_type: {},
    ...overrides,
  }
}

function chunk(overrides: Partial<ChunkResult> = {}): ChunkResult {
  return {
    text: 'chunk text',
    substitutions: 0,
    modelUsed: 'gpt-4o-mini',
    gate: gate(),
    gatesUnavailable: false,
    retryCount: 0,
    ...overrides,
  }
}

describe('aggregateChunkResults — averaging with a per-chunk unavailable gate', () => {
  it('averages semantic_similarity only over chunks where it actually ran, not treating null as 0', () => {
    const results = [
      chunk({ gate: gate({ semantic_similarity: 0.8 }) }),
      // This chunk's embedding call failed — semantic_similarity is null, but the
      // chunk itself was still scored (entity_overlap ran fine).
      chunk({ gate: gate({ semantic_similarity: null }) }),
    ]
    const agg = aggregateChunkResults(results)
    // Averaging in null as 0 would give 0.4 — the correct answer ignores
    // the chunk that couldn't be scored for this specific gate.
    expect(agg.semantic_similarity).toBe(0.8)
  })

  it('still averages entity_overlap normally since it is never null per chunk', () => {
    const results = [
      chunk({ gate: gate({ entity_overlap: 1 }) }),
      chunk({ gate: gate({ entity_overlap: 0.5 }) }),
    ]
    const agg = aggregateChunkResults(results)
    expect(agg.entity_overlap).toBe(0.75)
  })

  it('reports null for a score when no chunk was able to compute it', () => {
    const results = [
      chunk({ gate: gate({ semantic_similarity: null }) }),
      chunk({ gate: gate({ semantic_similarity: null }) }),
    ]
    const agg = aggregateChunkResults(results)
    expect(agg.semantic_similarity).toBeNull()
  })

  it('a failing entity_overlap chunk still marks the whole document as not passed, independent of other gates', () => {
    const results = [
      chunk({
        gate: gate({
          semantic_similarity: null,
          nli_entailment: null,
          entity_overlap: 0,
          passed: false,
          failed_gate: 'entity_overlap',
          missing_facts: ['42'],
        }),
      }),
    ]
    const agg = aggregateChunkResults(results)
    expect(agg.passed).toBe(false)
    expect(agg.failed_gate).toBe('entity_overlap')
    expect(agg.missing_facts).toEqual(['42'])
  })
})

import { describe, it, expect } from 'vitest'
import { aggregateChunkResults, buildUserPrompt, joinChunkResults, ChunkResult } from '../humanizePipeline'
import type { QualityScores } from '../qualityGates'
import type { TextChunk } from '../chunk'

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
    gates_available: { semantic_similarity: true, entailment: true },
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

describe('aggregateChunkResults — degraded/gates_available (partial gate outages must not read as a clean pass)', () => {
  it('is not degraded when every gate ran for every chunk', () => {
    const results = [chunk({ gate: gate() }), chunk({ gate: gate() })]
    const agg = aggregateChunkResults(results)
    expect(agg.degraded).toBe(false)
    expect(agg.gates_available).toEqual({ semantic_similarity: true, entailment: true })
  })

  it('is degraded, but still passed, when entity_overlap cleared and both soft gates never ran', () => {
    // This is the exact bug this fix closes: entity_overlap passing on its
    // own must not read identically to "everything was checked".
    const results = [
      chunk({
        gate: gate({
          semantic_similarity: null,
          nli_entailment: null,
          gates_available: { semantic_similarity: false, entailment: false },
        }),
      }),
    ]
    const agg = aggregateChunkResults(results)
    expect(agg.passed).toBe(true)
    expect(agg.degraded).toBe(true)
    expect(agg.gates_available).toEqual({ semantic_similarity: false, entailment: false })
  })

  it('is degraded when only one of several chunks was missing a gate, even though the rest were fully scored', () => {
    const results = [
      chunk({ gate: gate() }),
      chunk({ gate: gate({ nli_entailment: null, gates_available: { semantic_similarity: true, entailment: false } }) }),
    ]
    const agg = aggregateChunkResults(results)
    expect(agg.passed).toBe(true)
    expect(agg.degraded).toBe(true)
    expect(agg.gates_available).toEqual({ semantic_similarity: true, entailment: false })
  })

  it('a fully unavailable document (every chunk threw) reports degraded and passed:null, not a silent pass', () => {
    const results = [chunk({ gate: null, gatesUnavailable: true })]
    const agg = aggregateChunkResults(results)
    expect(agg.passed).toBeNull()
    expect(agg.degraded).toBe(true)
    expect(agg.gates_available).toEqual({ semantic_similarity: false, entailment: false })
  })
})

function textChunk(overrides: Partial<TextChunk> = {}): TextChunk {
  return { text: 'chunk text', factLocks: [], separatorAfter: '', ...overrides }
}

describe('joinChunkResults — reassembly using each chunk\'s real separator', () => {
  it('rejoins with the original paragraph break, not a fixed one', () => {
    const results = [chunk({ text: 'First part.' }), chunk({ text: 'Second part.' })]
    const chunks = [textChunk({ separatorAfter: '\n\n' }), textChunk({ separatorAfter: '' })]
    expect(joinChunkResults(results, chunks)).toBe('First part.\n\nSecond part.')
  })

  it('rejoins with a single space when that was the real separator (sentence-split, not paragraph-split)', () => {
    const results = [chunk({ text: 'First sentence.' }), chunk({ text: 'Second sentence.' })]
    const chunks = [textChunk({ separatorAfter: ' ' }), textChunk({ separatorAfter: '' })]
    expect(joinChunkResults(results, chunks)).toBe('First sentence. Second sentence.')
  })

  it('never appends a trailing separator after the last available result (partial/in-progress join)', () => {
    // Only 2 of eventually-3 chunks have finished — the second one's real
    // separatorAfter (leading into the still-unprocessed third chunk) must
    // not leak into the partial preview.
    const results = [chunk({ text: 'First.' }), chunk({ text: 'Second.' })]
    const chunks = [
      textChunk({ separatorAfter: '\n\n' }),
      textChunk({ separatorAfter: '\n\n' }), // would point at chunk 3, not yet processed
      textChunk({ separatorAfter: '' }),
    ]
    expect(joinChunkResults(results, chunks)).toBe('First.\n\nSecond.')
  })
})

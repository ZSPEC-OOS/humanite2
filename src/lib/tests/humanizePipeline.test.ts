import { describe, it, expect, vi } from 'vitest'
import type OpenAI from 'openai'
import { aggregateChunkResults, buildUserPrompt, joinChunkResults, humanizeChunk, ChunkResult } from '../humanizePipeline'
import type { QualityScores } from '../qualityGates'
import type { TextChunk } from '../chunk'
import type { FactLock } from '../preprocess'

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
    entailment: 0.95,
    entity_preservation: 1,
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
    truncated: false,
    retryCount: 0,
    ...overrides,
  }
}

describe('aggregateChunkResults — averaging with a per-chunk unavailable gate', () => {
  it('averages semantic_similarity only over chunks where it actually ran, not treating null as 0', () => {
    const results = [
      chunk({ gate: gate({ semantic_similarity: 0.8 }) }),
      // This chunk's embedding call failed — semantic_similarity is null, but the
      // chunk itself was still scored (entity_preservation ran fine).
      chunk({ gate: gate({ semantic_similarity: null }) }),
    ]
    const agg = aggregateChunkResults(results)
    // Averaging in null as 0 would give 0.4 — the correct answer ignores
    // the chunk that couldn't be scored for this specific gate.
    expect(agg.semantic_similarity).toBe(0.8)
  })

  it('still averages entity_preservation normally since it is never null per chunk', () => {
    const results = [
      chunk({ gate: gate({ entity_preservation: 1 }) }),
      chunk({ gate: gate({ entity_preservation: 0.5 }) }),
    ]
    const agg = aggregateChunkResults(results)
    expect(agg.entity_preservation).toBe(0.75)
  })

  it('reports null for a score when no chunk was able to compute it', () => {
    const results = [
      chunk({ gate: gate({ semantic_similarity: null }) }),
      chunk({ gate: gate({ semantic_similarity: null }) }),
    ]
    const agg = aggregateChunkResults(results)
    expect(agg.semantic_similarity).toBeNull()
  })

  it('a failing entity_preservation chunk still marks the whole document as not passed, independent of other gates', () => {
    const results = [
      chunk({
        gate: gate({
          semantic_similarity: null,
          entailment: null,
          entity_preservation: 0,
          passed: false,
          failed_gate: 'entity_preservation',
          missing_facts: ['42'],
        }),
      }),
    ]
    const agg = aggregateChunkResults(results)
    expect(agg.passed).toBe(false)
    expect(agg.failed_gate).toBe('entity_preservation')
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

  it('is degraded, but still passed, when entity_preservation cleared and both soft gates never ran', () => {
    // This is the exact bug this fix closes: entity_preservation passing on
    // its own must not read identically to "everything was checked".
    const results = [
      chunk({
        gate: gate({
          semantic_similarity: null,
          entailment: null,
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
      chunk({ gate: gate({ entailment: null, gates_available: { semantic_similarity: true, entailment: false } }) }),
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

describe('aggregateChunkResults — truncation', () => {
  it('is not truncated when no chunk was cut off', () => {
    const agg = aggregateChunkResults([chunk(), chunk()])
    expect(agg.truncated).toBe(false)
  })

  it('reports truncated when any single chunk was cut off, even if the rest were clean', () => {
    const results = [chunk(), chunk({ truncated: true, gate: gate({ passed: false, failed_gate: 'truncated' }) })]
    const agg = aggregateChunkResults(results)
    expect(agg.truncated).toBe(true)
    // A truncated chunk's own gate is already forced to passed:false upstream
    // (see humanizeChunk) — the aggregate reflects that without any special
    // casing here.
    expect(agg.passed).toBe(false)
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

// ── humanizeChunk — end-to-end retry/truncation behavior ────────────────────

function mockHumanizeClient(
  chatResponses: Array<{ content: string; model?: string; finish_reason?: string }>,
  embedding: [number[], number[]] = [[1, 0], [1, 0]],
) {
  const chatCreate = vi.fn()
  for (const r of chatResponses) {
    chatCreate.mockResolvedValueOnce({
      model: r.model ?? 'gpt-4o-mini',
      choices: [{ message: { content: r.content }, finish_reason: r.finish_reason ?? 'stop' }],
    })
  }
  const embedCreate = vi.fn().mockResolvedValue({ data: [{ embedding: embedding[0] }, { embedding: embedding[1] }] })
  return {
    client: { chat: { completions: { create: chatCreate } }, embeddings: { create: embedCreate } } as unknown as OpenAI,
    chatCreate,
  }
}

const FACT_42: FactLock = { char_start: 0, char_end: 2, text: '42', lock_type: 'number', label: 'NUM' }

describe('humanizeChunk — retry loop ships the best-scoring attempt, not just the last one', () => {
  it('keeps an earlier attempt that preserved a required fact over a later attempt that dropped it', async () => {
    const { client } = mockHumanizeClient([
      { content: 'Revenue rose to 42 units, though the phrasing drifted oddly.' }, // attempt 0 generation — keeps "42"
      { content: '{"entailment_probability": 0.2, "issues": ["odd phrasing drift"]}' }, // attempt 0 judge — fails entailment
      { content: 'Revenue rose sharply, a notable turnaround for the quarter.' }, // attempt 1 generation — drops "42"
      { content: '{"entailment_probability": 1.0, "issues": []}' }, // attempt 1 judge — entailment now fine
    ])

    const result = await humanizeChunk(
      client, 'gpt-4o-mini', 'fallback', 'Revenue rose to 42 units.', [FACT_42],
      3, 'balanced', 'general', 1, // maxRetries=1 → two attempts total; intensity<=3 skips postprocess
    )

    // The last attempt "fixed" entailment but at the cost of the one thing
    // that must never regress — a locked fact. The earlier attempt, which
    // only failed on style, is the better ship.
    expect(result.text).toContain('42')
    expect(result.gate?.failed_gate).toBe('entailment')
    expect(result.retryCount).toBe(1)
  })
})

describe('humanizeChunk — truncation detection', () => {
  it('retries after a cut-off completion, boosting the token budget, and ships the later complete attempt', async () => {
    const { client, chatCreate } = mockHumanizeClient([
      { content: 'Revenue rose to 42 units before the completion cut off', finish_reason: 'length' },
      { content: '{"entailment_probability": 1.0, "issues": []}' },
      { content: 'Revenue rose to 42 units, a clean and complete rewrite.', finish_reason: 'stop' },
      { content: '{"entailment_probability": 1.0, "issues": []}' },
    ])

    const result = await humanizeChunk(
      client, 'gpt-4o-mini', 'fallback', 'Revenue rose to 42 units.', [FACT_42],
      3, 'balanced', 'general', 1,
    )

    expect(result.truncated).toBe(false)
    expect(result.gate?.passed).toBe(true)
    expect(result.retryCount).toBe(1)
    // The retry after a truncation raises max_tokens above the first attempt's.
    const firstGenerationTokens = chatCreate.mock.calls[0]![0].max_tokens
    const secondGenerationTokens = chatCreate.mock.calls[2]![0].max_tokens
    expect(secondGenerationTokens).toBeGreaterThan(firstGenerationTokens)
  })

  it('never ships a truncated attempt as validated, even when it is the only attempt available', async () => {
    const { client } = mockHumanizeClient([
      { content: 'Revenue rose to 42 units before the completion cut off', finish_reason: 'length' },
      { content: '{"entailment_probability": 1.0, "issues": []}' },
      { content: 'Revenue rose to 42 units before the completion cut off again', finish_reason: 'length' },
      { content: '{"entailment_probability": 1.0, "issues": []}' },
    ])

    const result = await humanizeChunk(
      client, 'gpt-4o-mini', 'fallback', 'Revenue rose to 42 units.', [FACT_42],
      3, 'balanced', 'general', 1,
    )

    expect(result.truncated).toBe(true)
    expect(result.gate?.passed).toBe(false)
    expect(result.gate?.failed_gate).toBe('truncated')
  })
})

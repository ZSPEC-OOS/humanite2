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

describe('buildUserPrompt — style compiler integration', () => {
  it('compiles the casual tone into explicit contraction guidance for a domain with no override', () => {
    const prompt = buildUserPrompt('some text', [], 5, 'casual', 'general')
    expect(prompt).toContain('Tone: casual')
    expect(prompt).toContain('Domain: general')
    expect(prompt).toMatch(/use contractions freely/i)
  })

  it('lets the legal domain override the casual tone\'s contraction guidance', () => {
    const prompt = buildUserPrompt('some text', [], 5, 'casual', 'legal')
    expect(prompt).toMatch(/never use contractions, regardless of the selected tone/i)
    expect(prompt).not.toMatch(/use contractions freely/i)
    // Legal's other domain constraints (defined terms, modality, conditions)
    // are present too, not just the contraction override.
    expect(prompt).toMatch(/preserve every defined term/i)
    expect(prompt).toMatch(/"shall" must not become/i)
  })

  it('falls back to balanced/general rather than throwing on an unrecognized tone or domain', () => {
    const prompt = buildUserPrompt('some text', [], 5, 'not-a-real-tone', 'not-a-real-domain')
    expect(prompt).toContain('Tone: balanced')
    expect(prompt).toContain('Domain: general')
  })
})

describe('buildUserPrompt — intensity guide integration', () => {
  it('embeds a distinct, level-specific intensity guide with no leftover duplicate label', () => {
    const low = buildUserPrompt('some text', [], 2, 'balanced', 'general')
    const high = buildUserPrompt('some text', [], 9, 'balanced', 'general')
    expect(low).toContain('Intensity 2/10')
    expect(high).toContain('Intensity 9/10')
    expect(low).not.toBe(high)
    // Exactly one "Intensity" line — no leftover flat "Intensity: X/10" label
    // duplicating what the compiled guide already states.
    expect(low.match(/Intensity/g)).toHaveLength(1)
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
    tone_alignment: 0.9,
    domain_alignment: 0.9,
    coherence: 0.9,
    naturalness: 0.9,
    style_issues: [],
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
    intensityAlignment: 0.9,
    repair: { attempted: false, strategy: 'none', succeeded: false, sentencesRepaired: 0 },
    claimVerification: { checked: 0, failed: 0, issues: [] },
    relationRepair: { attempted: false, strategy: 'none', succeeded: false, sentencesRepaired: 0 },
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

describe('aggregateChunkResults — style scores and repair summary', () => {
  it('averages style scores across chunks the same null-safe way as entailment/similarity', () => {
    const results = [
      chunk({ gate: gate({ tone_alignment: 0.8, domain_alignment: 0.6 }) }),
      chunk({ gate: gate({ tone_alignment: null, domain_alignment: 0.4 }) }),
    ]
    const agg = aggregateChunkResults(results)
    expect(agg.tone_alignment).toBe(0.8)
    expect(agg.domain_alignment).toBe(0.5)
  })

  it('averages intensity_alignment across ALL chunks, independent of whether gates ran', () => {
    const results = [
      chunk({ intensityAlignment: 0.8, gatesUnavailable: true, gate: null }),
      chunk({ intensityAlignment: 0.4 }),
    ]
    const agg = aggregateChunkResults(results)
    expect(agg.intensity_alignment).toBe(0.6)
  })

  it('reports repair.attempted only when at least one chunk actually attempted a repair', () => {
    const results = [chunk(), chunk()]
    expect(aggregateChunkResults(results).repair.attempted).toBe(false)
  })

  it('reports repair.succeeded false if any chunk that attempted a repair failed to fix it', () => {
    const results = [
      chunk({ repair: { attempted: true, strategy: 'sentence_repair', succeeded: true, sentencesRepaired: 1 } }),
      chunk({ repair: { attempted: true, strategy: 'sentence_repair', succeeded: false, sentencesRepaired: 0 } }),
    ]
    const agg = aggregateChunkResults(results)
    expect(agg.repair.attempted).toBe(true)
    expect(agg.repair.succeeded).toBe(false)
    expect(agg.repair.sentences_repaired).toBe(1)
  })
})

describe('aggregateChunkResults — Phase 7 claim verification and relation repair', () => {
  it('sums claims_checked and claims_failed, and concatenates issues, across chunks', () => {
    const results = [
      chunk({ claimVerification: { checked: 3, failed: 1, issues: ['causal direction reversed'] } }),
      chunk({ claimVerification: { checked: 2, failed: 0, issues: [] } }),
    ]
    const agg = aggregateChunkResults(results)
    expect(agg.claims_checked).toBe(5)
    expect(agg.claims_failed).toBe(1)
    expect(agg.claim_issues).toEqual(['causal direction reversed'])
  })

  it('treats a null claimVerification (the check itself did not run) as contributing zero, not throwing', () => {
    const results = [chunk({ claimVerification: null }), chunk({ claimVerification: { checked: 4, failed: 2, issues: ['a', 'b'] } })]
    const agg = aggregateChunkResults(results)
    expect(agg.claims_checked).toBe(4)
    expect(agg.claims_failed).toBe(2)
  })

  it('reports relation_repair.attempted only when at least one chunk actually attempted it', () => {
    const results = [chunk(), chunk()]
    expect(aggregateChunkResults(results).relation_repair.attempted).toBe(false)
  })

  it('reports relation_repair.succeeded false if any chunk that attempted it failed to fix it', () => {
    const results = [
      chunk({ relationRepair: { attempted: true, strategy: 'restore_relations', succeeded: true, sentencesRepaired: 1 } }),
      chunk({ relationRepair: { attempted: true, strategy: 'restore_relations', succeeded: false, sentencesRepaired: 0 } }),
    ]
    const agg = aggregateChunkResults(results)
    expect(agg.relation_repair.attempted).toBe(true)
    expect(agg.relation_repair.succeeded).toBe(false)
    expect(agg.relation_repair.sentences_repaired).toBe(1)
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

describe('humanizeChunk — targeted post-loop repair for position-blind fact failures', () => {
  it('repairs a fact swap that the ordinary gates missed entirely, using one extra generation call plus one re-score', async () => {
    const source = 'Server Alpha runs firmware 2.1; Server Beta runs firmware 3.4.'
    const swapped = 'Server Alpha runs firmware 3.4; Server Beta runs firmware 2.1.'
    const passingJudge = JSON.stringify({ entailment_probability: 1.0, tone_alignment: 1, domain_alignment: 1, coherence: 1, naturalness: 1 })

    const { client, chatCreate } = mockHumanizeClient([
      { content: swapped }, // attempt 0 generation — the model swaps the two versions
      { content: passingJudge }, // attempt 0 judge — entity/entailment/similarity all pass; blind to the swap
      { content: source }, // repair: the sentence-level fix, correctly unswapped
      { content: passingJudge }, // re-score of the repaired text
      { content: '{"claims": []}' }, // Phase 7 claim verification — nothing to flag
    ])

    const result = await humanizeChunk(client, 'gpt-4o-mini', 'fallback', source, [], 3, 'balanced', 'technical', 0)

    expect(result.text).toBe(source)
    expect(result.repair.attempted).toBe(true)
    expect(result.repair.succeeded).toBe(true)
    expect(result.repair.sentencesRepaired).toBe(1)
    // Exactly 5 chat calls: no extra full-chunk retry was spent on the fact
    // repair — it's a single targeted addition, not another regeneration —
    // plus the one always-on claim verification call.
    expect(chatCreate).toHaveBeenCalledTimes(5)
  })

  it('leaves gate.passed alone (already true) but reports no repair attempted when the output is already fidelity-correct', async () => {
    const source = 'Revenue rose to 42 units.'
    const passingJudge = JSON.stringify({ entailment_probability: 1.0, tone_alignment: 1, domain_alignment: 1, coherence: 1, naturalness: 1 })

    const { client, chatCreate } = mockHumanizeClient([
      { content: source },
      { content: passingJudge },
      { content: '{"claims": []}' },
    ])

    const result = await humanizeChunk(client, 'gpt-4o-mini', 'fallback', source, [], 3, 'balanced', 'general', 0)

    expect(result.repair.attempted).toBe(false)
    expect(chatCreate).toHaveBeenCalledTimes(3)
  })

  it('computes an intensity_alignment score for the shipped text', async () => {
    const source = 'Revenue rose to 42 units.'
    const passingJudge = JSON.stringify({ entailment_probability: 1.0, tone_alignment: 1, domain_alignment: 1, coherence: 1, naturalness: 1 })
    const { client } = mockHumanizeClient([
      { content: 'Revenue climbed to 42 units in total, a notable shift from the prior period.' },
      { content: passingJudge },
    ])

    const result = await humanizeChunk(client, 'gpt-4o-mini', 'fallback', source, [], 3, 'balanced', 'general', 0)

    expect(result.intensityAlignment).not.toBeNull()
    expect(result.intensityAlignment).toBeGreaterThanOrEqual(0)
    expect(result.intensityAlignment).toBeLessThanOrEqual(1)
  })
})

describe('humanizeChunk — Phase 7 model-based claim verification', () => {
  const passingJudge = JSON.stringify({ entailment_probability: 1.0, tone_alignment: 1, domain_alignment: 1, coherence: 1, naturalness: 1 })

  it('reports a passing claim verification and makes no relation-repair call when nothing fails', async () => {
    const source = 'Because sales grew sharply, the company increased hiring.'
    const { client, chatCreate } = mockHumanizeClient([
      { content: source },
      { content: passingJudge },
      { content: '{"claims": [{"subject": "sales", "predicate": "grew", "object": "sharply", "qualifiers": [], "polarity": "affirmative", "modality": null, "entailed": true, "reason": "", "output_sentence_index": null}]}' },
    ])

    const result = await humanizeChunk(client, 'gpt-4o-mini', 'fallback', source, [], 3, 'balanced', 'business', 0)

    expect(result.claimVerification).toEqual({ checked: 1, failed: 0, issues: [] })
    expect(result.relationRepair.attempted).toBe(false)
    expect(chatCreate).toHaveBeenCalledTimes(3)
  })

  it('repairs a localized relation failure and adopts it once re-verification confirms the fix', async () => {
    const source = 'Because sales grew sharply, the company increased hiring across every region.'
    const swapped = 'Because the company increased hiring across every region, sales grew sharply.'
    const failingClaims = JSON.stringify({
      claims: [{
        subject: 'the company', predicate: 'increased', object: 'hiring', qualifiers: ['across every region'],
        polarity: 'affirmative', modality: null, entailed: false, reason: 'causal direction reversed', output_sentence_index: 0,
      }],
    })
    const passingClaims = '{"claims": []}'

    const { client, chatCreate } = mockHumanizeClient([
      { content: swapped }, // generation — reverses the causal direction
      { content: passingJudge }, // ordinary gates: blind to the reversal
      { content: failingClaims }, // claim verification: catches it
      { content: source }, // restore-relations: the sentence-level fix
      { content: passingClaims }, // re-verification of the repaired text
    ])

    const result = await humanizeChunk(client, 'gpt-4o-mini', 'fallback', source, [], 3, 'balanced', 'business', 0)

    expect(result.text).toBe(source)
    expect(result.relationRepair.attempted).toBe(true)
    expect(result.relationRepair.succeeded).toBe(true)
    expect(result.relationRepair.sentencesRepaired).toBe(1)
    expect(result.claimVerification).toEqual({ checked: 0, failed: 0, issues: [] })
    expect(chatCreate).toHaveBeenCalledTimes(5)
  })

  it('does not adopt a relation repair that a free fact-ledger check shows dropped a locked fact', async () => {
    const source = 'The dose is 5 mg, according to the lead investigator.'
    const failingClaims = JSON.stringify({
      claims: [{
        subject: 'the lead investigator', predicate: 'stated', object: 'the dose', qualifiers: [],
        polarity: 'affirmative', modality: null, entailed: false, reason: 'attribution changed', output_sentence_index: 0,
      }],
    })
    const { client, chatCreate } = mockHumanizeClient([
      { content: source },
      { content: passingJudge },
      { content: failingClaims },
      // The "fix" drops the locked "5 mg" entirely — must never be adopted.
      { content: 'The dose is unspecified, according to the lead investigator.' },
    ])

    const result = await humanizeChunk(
      client, 'gpt-4o-mini', 'fallback', source, [{ char_start: 0, char_end: 4, text: '5 mg', lock_type: 'number', label: 'NUM' }],
      3, 'balanced', 'medical', 0,
    )

    expect(result.text).toBe(source)
    expect(result.relationRepair.succeeded).toBe(false)
    // No re-verification call spent once the free fact check already rejected the fix.
    expect(chatCreate).toHaveBeenCalledTimes(4)
  })

  it('never throws and leaves claimVerification null when the verification call itself fails', async () => {
    const source = 'Revenue rose to 42 units.'
    const chatCreate = vi.fn()
      .mockResolvedValueOnce({ model: 'gpt-4o-mini', choices: [{ message: { content: source }, finish_reason: 'stop' }] })
      .mockResolvedValueOnce({ model: 'gpt-4o-mini', choices: [{ message: { content: passingJudge }, finish_reason: 'stop' }] })
      .mockRejectedValueOnce(new Error('judge model unreachable'))
    const embedCreate = vi.fn().mockResolvedValue({ data: [{ embedding: [1, 0] }, { embedding: [1, 0] }] })
    const client = { chat: { completions: { create: chatCreate } }, embeddings: { create: embedCreate } } as unknown as OpenAI

    const result = await humanizeChunk(client, 'gpt-4o-mini', 'fallback', source, [], 3, 'balanced', 'general', 0)

    expect(result.claimVerification).toBeNull()
    expect(result.relationRepair.attempted).toBe(false)
    expect(result.text).toBe(source)
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

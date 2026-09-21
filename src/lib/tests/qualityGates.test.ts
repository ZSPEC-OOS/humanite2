import { describe, it, expect, vi } from 'vitest'
import type OpenAI from 'openai'
import {
  checkEntityOverlap,
  cosineSimilarity,
  checkSemanticSimilarity,
  checkEntailment,
  runQualityGates,
} from '../qualityGates'
import type { FactLock } from '../preprocess'

function lock(text: string, lock_type: FactLock['lock_type'] = 'number'): FactLock {
  return { char_start: 0, char_end: text.length, text, lock_type, label: lock_type.toUpperCase() }
}

// ── Gate 1: entity overlap — 20-document fixture set ─────────────────────────
// Covers numbers, dates, and citations, each either fully preserved, partially
// dropped, or entirely absent from the rewrite. Acceptance criterion: 100%
// recall — every dropped fact must be caught, every preserved fact must not
// be flagged.

interface Fixture {
  name: string
  output: string
  locks: FactLock[]
  expectedScore: number
  expectedMissing: string[]
}

const FIXTURES: Fixture[] = [
  { name: '1 — single number preserved', output: 'Revenue grew by 12% last quarter.', locks: [lock('12%')], expectedScore: 1, expectedMissing: [] },
  { name: '2 — single number dropped', output: 'Revenue grew significantly last quarter.', locks: [lock('12%')], expectedScore: 0, expectedMissing: ['12%'] },
  { name: '3 — date preserved', output: 'The meeting is set for January 5, 2024.', locks: [lock('January 5, 2024', 'date')], expectedScore: 1, expectedMissing: [] },
  { name: '4 — date reformatted (counts as dropped, verbatim required)', output: 'The meeting is set for 2024-01-05.', locks: [lock('January 5, 2024', 'date')], expectedScore: 0, expectedMissing: ['January 5, 2024'] },
  { name: '5 — citation preserved', output: 'This finding replicates prior work [12].', locks: [lock('[12]', 'citation')], expectedScore: 1, expectedMissing: [] },
  { name: '6 — citation dropped', output: 'This finding replicates prior work.', locks: [lock('[12]', 'citation')], expectedScore: 0, expectedMissing: ['[12]'] },
  { name: '7 — two numbers both preserved', output: '3 of the 7 tests failed.', locks: [lock('3'), lock('7')], expectedScore: 1, expectedMissing: [] },
  { name: '8 — two numbers, one dropped', output: 'Several of the 7 tests failed.', locks: [lock('3'), lock('7')], expectedScore: 0.5, expectedMissing: ['3'] },
  { name: '9 — two numbers, both dropped', output: 'Several tests failed.', locks: [lock('3'), lock('7')], expectedScore: 0, expectedMissing: ['3', '7'] },
  { name: '10 — mixed types all preserved', output: 'On March 3, 2023, 45 people cited (Lee, 2023).', locks: [lock('March 3, 2023', 'date'), lock('45'), lock('(Lee, 2023)', 'citation')], expectedScore: 1, expectedMissing: [] },
  { name: '11 — mixed types, citation dropped', output: 'On March 3, 2023, 45 people attended.', locks: [lock('March 3, 2023', 'date'), lock('45'), lock('(Lee, 2023)', 'citation')], expectedScore: 2 / 3, expectedMissing: ['(Lee, 2023)'] },
  { name: '12 — no locks at all', output: 'A completely unremarkable sentence.', locks: [], expectedScore: 1, expectedMissing: [] },
  { name: '13 — number embedded mid-word boundary preserved', output: 'The model scored 98.6 on the benchmark.', locks: [lock('98.6')], expectedScore: 1, expectedMissing: [] },
  { name: '14 — number truncated (dropped)', output: 'The model scored 98 on the benchmark.', locks: [lock('98.6')], expectedScore: 0, expectedMissing: ['98.6'] },
  { name: '15 — currency preserved', output: 'The contract is valued at $4.2M.', locks: [lock('$4.2M')], expectedScore: 1, expectedMissing: [] },
  { name: '16 — currency reformatted (dropped)', output: 'The contract is valued at 4.2 million dollars.', locks: [lock('$4.2M')], expectedScore: 0, expectedMissing: ['$4.2M'] },
  { name: '17 — three citations, two preserved', output: 'Findings align with [1] and [2].', locks: [lock('[1]', 'citation'), lock('[2]', 'citation'), lock('[3]', 'citation')], expectedScore: 2 / 3, expectedMissing: ['[3]'] },
  { name: '18 — percentage and date both preserved across rewrite', output: 'By December 1, 2022, adoption had reached 61%, driven by demand.', locks: [lock('December 1, 2022', 'date'), lock('61%')], expectedScore: 1, expectedMissing: [] },
  { name: '19 — all facts dropped', output: 'Things changed a lot recently.', locks: [lock('61%'), lock('December 1, 2022', 'date'), lock('[4]', 'citation')], expectedScore: 0, expectedMissing: ['61%', 'December 1, 2022', '[4]'] },
  { name: '20 — duplicated fact text still matches by substring', output: 'It happened in 2019, and again in 2019.', locks: [lock('2019', 'date')], expectedScore: 1, expectedMissing: [] },
]

describe('checkEntityOverlap — fixture set', () => {
  it.each(FIXTURES)('$name', ({ output, locks, expectedScore, expectedMissing }) => {
    const result = checkEntityOverlap(output, locks)
    expect(result.score).toBeCloseTo(expectedScore, 6)
    expect(result.missing.sort()).toEqual([...expectedMissing].sort())
  })

  it('has 100% recall across the full fixture set (never misses a dropped fact)', () => {
    for (const { output, locks, expectedMissing } of FIXTURES) {
      const { missing } = checkEntityOverlap(output, locks)
      for (const expectedMiss of expectedMissing) {
        expect(missing).toContain(expectedMiss)
      }
    }
  })
})

// ── Gate 2: cosine similarity (pure math) ────────────────────────────────────

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 6)
  })

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6)
  })

  it('returns -1 for opposite vectors', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 6)
  })

  it('returns 0 for a zero vector instead of NaN', () => {
    expect(cosineSimilarity([0, 0], [1, 1])).toBe(0)
  })
})

describe('checkSemanticSimilarity', () => {
  it('embeds both texts in one call and returns their cosine similarity', async () => {
    const create = vi.fn().mockResolvedValue({
      data: [{ embedding: [1, 0] }, { embedding: [1, 0] }],
    })
    const client = { embeddings: { create } } as unknown as OpenAI

    const score = await checkSemanticSimilarity(client, 'original', 'output')

    expect(create).toHaveBeenCalledWith({
      model: 'text-embedding-3-small',
      input: ['original', 'output'],
    })
    expect(score).toBeCloseTo(1, 6)
  })
})

// ── Gate 3: entailment (mocked LLM judge) ────────────────────────────────────

function mockChatClient(content: string) {
  const create = vi.fn().mockResolvedValue({
    model: 'gpt-4o-mini',
    choices: [{ message: { content } }],
  })
  return { client: { chat: { completions: { create } } } as unknown as OpenAI, create }
}

describe('checkEntailment', () => {
  it('parses a fully-faithful judgment', async () => {
    const { client } = mockChatClient('{"entailment_probability": 1.0, "issues": []}')
    const result = await checkEntailment(client, 'gpt-4o-mini', 'orig', 'out')
    expect(result.score).toBe(1)
    expect(result.issues).toEqual([])
  })

  it('parses a contradiction judgment with issues', async () => {
    const { client } = mockChatClient(
      '{"entailment_probability": 0.2, "issues": ["changed 12% to 15%", "dropped the 2019 date"]}',
    )
    const result = await checkEntailment(client, 'gpt-4o-mini', 'orig', 'out')
    expect(result.score).toBe(0.2)
    expect(result.issues).toHaveLength(2)
  })

  it('clamps out-of-range scores and tolerates malformed JSON gracefully', async () => {
    const { client } = mockChatClient('not valid json')
    await expect(checkEntailment(client, 'gpt-4o-mini', 'orig', 'out')).rejects.toThrow()
  })

  it('clamps a score above 1 down to 1', async () => {
    const { client } = mockChatClient('{"entailment_probability": 1.5, "issues": []}')
    const result = await checkEntailment(client, 'gpt-4o-mini', 'orig', 'out')
    expect(result.score).toBe(1)
  })
})

// ── Orchestrator ──────────────────────────────────────────────────────────────

describe('runQualityGates', () => {
  function mockClient(entailmentJson: string, embedding: [number[], number[]]) {
    const chatCreate = vi.fn().mockResolvedValue({
      model: 'gpt-4o-mini',
      choices: [{ message: { content: entailmentJson } }],
    })
    const embedCreate = vi.fn().mockResolvedValue({
      data: [{ embedding: embedding[0] }, { embedding: embedding[1] }],
    })
    return {
      chat: { completions: { create: chatCreate } },
      embeddings: { create: embedCreate },
    } as unknown as OpenAI
  }

  it('passes when all three gates clear their thresholds', async () => {
    const client = mockClient('{"entailment_probability": 1.0, "issues": []}', [[1, 0], [1, 0]])
    const result = await runQualityGates(client, 'gpt-4o-mini', 'the cat sat', 'the cat sat', [lock('cat')])
    expect(result.passed).toBe(true)
    expect(result.failed_gate).toBeNull()
  })

  it('reports entity_overlap first when both entity overlap and entailment fail', async () => {
    const client = mockClient('{"entailment_probability": 0.1, "issues": ["dropped fact"]}', [[1, 0], [1, 0]])
    const result = await runQualityGates(client, 'gpt-4o-mini', 'orig', 'output missing the fact', [lock('42')])
    expect(result.failed_gate).toBe('entity_overlap')
    expect(result.passed).toBe(false)
  })

  it('reports entailment when entity overlap passes but entailment fails', async () => {
    const client = mockClient('{"entailment_probability": 0.1, "issues": ["invented a claim"]}', [[1, 0], [1, 0]])
    const result = await runQualityGates(client, 'gpt-4o-mini', 'orig', 'output', [])
    expect(result.failed_gate).toBe('entailment')
    expect(result.entailment_issues).toEqual(['invented a claim'])
  })

  it('reports semantic_similarity when only the embedding similarity is low', async () => {
    const client = mockClient('{"entailment_probability": 1.0, "issues": []}', [[1, 0], [0, 1]])
    const result = await runQualityGates(client, 'gpt-4o-mini', 'orig', 'output', [])
    expect(result.failed_gate).toBe('semantic_similarity')
  })
})

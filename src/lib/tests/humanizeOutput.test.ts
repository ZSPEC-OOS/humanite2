import { describe, it, expect, vi, afterEach } from 'vitest'
import { buildOutput, tryClassifyOutput } from '@/lib/humanizeOutput'
import { generateWatermark } from '@/lib/watermark'
import { resetDetectionGatewayForTests } from '@/lib/detection/gateway'
import type { ChunkResult } from '@/lib/humanizePipeline'

// This file exercises detection-integration semantics (mock provider,
// fixture-controlled results), not usage limits (see usageLimits.test.ts) —
// stub the scan-quota check so tryClassifyOutput's calls never touch
// Firestore. Passing a real gptzeroApiKey instead would also skip this, but
// it changes DetectionGateway's provider selection to the real GPTZero
// class instead of the mock — not what these tests want.
vi.mock('@/lib/usageLimits', () => ({
  checkAndRecordScanUsage: async () => ({ allowed: true }),
}))

const ORIGINAL_ENV = { ...process.env }

function resetEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key]
  }
  Object.assign(process.env, ORIGINAL_ENV)
  resetDetectionGatewayForTests()
}

function chunk(overrides: Partial<ChunkResult> = {}): ChunkResult {
  return {
    text: 'Rewritten chunk text.',
    substitutions: 0,
    modelUsed: 'gpt-4o-mini',
    gate: {
      semantic_similarity: 0.94, entailment: 0.97, entity_preservation: 1, passed: true, failed_gate: null,
      gates_available: { semantic_similarity: true, entailment: true }, missing_facts: [], entailment_issues: [], preservation_by_type: {},
      tone_alignment: null, domain_alignment: null, coherence: null, naturalness: null, style_issues: [],
    },
    gatesUnavailable: false,
    truncated: false,
    retryCount: 0,
    intensityAlignment: null,
    repair: { attempted: false, strategy: 'none', succeeded: false, sentencesRepaired: 0 },
    claimVerification: null,
    relationRepair: { attempted: false, strategy: 'none', succeeded: false, sentencesRepaired: 0 },
    ...overrides,
  }
}

describe('humanize route: detection integration (spec §30, §48)', () => {
  afterEach(resetEnv)

  // A gptzeroApiKey is passed throughout (BYOK path) so these calls skip
  // checkAndRecordScanUsage's Firestore-backed quota check entirely — this
  // file is testing detection-integration semantics, not usage limits
  // (see usageLimits.test.ts for that), so it shouldn't need a Firestore mock.
  it('humanization succeeds even when detection fails — never propagates the failure', async () => {
    process.env.MOCK_DETECTION_FIXTURE = 'rate-limit'
    const detection = await tryClassifyOutput('Some humanized output text.', 'test-user', 'free')
    expect(detection).toBeNull()

    const watermark = generateWatermark('job-1', 'gpt-4o-mini')
    const output = buildOutput('Some humanized output text.', [chunk()], watermark, detection)

    expect(output.text).toBe('Some humanized output text.')
    expect(output.detection).toBeNull()
    expect(output.detection_warning).toBe('AI detection unavailable')
    // The rest of the output is unaffected — quality scores and watermark
    // are fully populated regardless of what happened to detection.
    expect(output.quality_scores.schema_version).toBe(2)
    expect(output.quality_scores.fidelity.passed).toBe(true)
    expect(output.quality_scores.overall.validated).toBe(true)
    expect(output.quality_scores.style.passed).toBeNull()
    expect(output.watermark.job_id).toBe('job-1')
  })

  it('an ai-generated detection result threads through with no warning', async () => {
    process.env.MOCK_DETECTION_FIXTURE = 'ai'
    const detection = await tryClassifyOutput('Some humanized output text.', 'test-user', 'free')
    const output = buildOutput('Some humanized output text.', [chunk()], generateWatermark('job-2', 'gpt-4o-mini'), detection)

    expect(output.detection?.classification).toBe('ai-generated')
    expect(output.detection_warning).toBeNull()
  })

  it('a human-written detection result threads through with no warning', async () => {
    process.env.MOCK_DETECTION_FIXTURE = 'human'
    const detection = await tryClassifyOutput('Some humanized output text.', 'test-user', 'free')
    const output = buildOutput('Some humanized output text.', [chunk()], generateWatermark('job-3', 'gpt-4o-mini'), detection)

    expect(output.detection?.classification).toBe('human-written')
    expect(output.detection_warning).toBeNull()
  })

  it('a mixed detection result threads through with no warning', async () => {
    process.env.MOCK_DETECTION_FIXTURE = 'mixed'
    const detection = await tryClassifyOutput('Some humanized output text.', 'test-user', 'free')
    const output = buildOutput('Some humanized output text.', [chunk()], generateWatermark('job-4', 'gpt-4o-mini'), detection)

    expect(output.detection?.classification).toBe('mixed')
    expect(output.detection_warning).toBeNull()
  })

  it('large document: aggregates multiple chunks alongside a single whole-document detection result', async () => {
    process.env.MOCK_DETECTION_FIXTURE = 'human'
    const detection = await tryClassifyOutput('Chunk one. Chunk two. Chunk three.', 'test-user', 'free')

    const chunks = [
      chunk({ text: 'Chunk one.', substitutions: 2, retryCount: 1 }),
      chunk({ text: 'Chunk two.', substitutions: 0, retryCount: 0 }),
      chunk({
        text: 'Chunk three.', substitutions: 3, retryCount: 1,
        gate: {
          semantic_similarity: 0.7, entailment: 0.8, entity_preservation: 0.9, passed: false, failed_gate: 'semantic_similarity',
          gates_available: { semantic_similarity: true, entailment: true }, missing_facts: [], entailment_issues: ['drift'], preservation_by_type: {},
          tone_alignment: null, domain_alignment: null, coherence: null, naturalness: null, style_issues: [],
        },
      }),
    ]
    const postText = chunks.map(c => c.text).join('\n\n')
    const output = buildOutput(postText, chunks, generateWatermark('job-5', 'gpt-4o-mini'), detection)

    // Detection ran once against the whole assembled document, not per chunk.
    expect(output.detection?.classification).toBe('human-written')
    // Chunk-level results still aggregate correctly across the whole document.
    expect(output.postprocessor_substitutions).toBe(5)
    expect(output.quality_scores.fidelity.retry_count).toBe(2)
    expect(output.quality_scores.fidelity.passed).toBe(false)
    expect(output.quality_scores.fidelity.failed_gate).toBe('semantic_similarity')
    expect(output.quality_scores.overall.validated).toBe(false)
  })

  it('populates real style scores and folds them into overall.validated once every chunk\'s gate reports them', async () => {
    process.env.MOCK_DETECTION_FIXTURE = 'human'
    const detection = await tryClassifyOutput('Some humanized output text.', 'test-user', 'free')
    const styledChunk = chunk({
      intensityAlignment: 0.9,
      gate: {
        semantic_similarity: 0.94, entailment: 0.97, entity_preservation: 1, passed: true, failed_gate: null,
        gates_available: { semantic_similarity: true, entailment: true }, missing_facts: [], entailment_issues: [], preservation_by_type: {},
        tone_alignment: 0.8, domain_alignment: 0.75, coherence: 0.9, naturalness: 0.6, style_issues: ['slightly stiff'],
      },
    })
    const output = buildOutput('Some humanized output text.', [styledChunk], generateWatermark('job-6', 'gpt-4o-mini'), detection)

    expect(output.quality_scores.style.tone_alignment).toBe(0.8)
    expect(output.quality_scores.style.domain_alignment).toBe(0.75)
    expect(output.quality_scores.style.naturalness).toBe(0.6)
    expect(output.quality_scores.style.intensity_alignment).toBe(0.9)
    expect(output.quality_scores.style.issues).toEqual(['slightly stiff'])
    expect(output.quality_scores.style.passed).toBe(true)
    // Fidelity AND style both passed — the combined verdict now reflects both.
    expect(output.quality_scores.overall.validated).toBe(true)
  })

  it('a failing style dimension pulls overall.validated down even when fidelity alone passed', async () => {
    process.env.MOCK_DETECTION_FIXTURE = 'human'
    const detection = await tryClassifyOutput('Some humanized output text.', 'test-user', 'free')
    const offToneChunk = chunk({
      intensityAlignment: 0.9,
      gate: {
        semantic_similarity: 0.94, entailment: 0.97, entity_preservation: 1, passed: true, failed_gate: null,
        gates_available: { semantic_similarity: true, entailment: true }, missing_facts: [], entailment_issues: [], preservation_by_type: {},
        tone_alignment: 0.1, domain_alignment: 0.9, coherence: 0.9, naturalness: 0.9, style_issues: ['wrong register entirely'],
      },
    })
    const output = buildOutput('Some humanized output text.', [offToneChunk], generateWatermark('job-7', 'gpt-4o-mini'), detection)

    expect(output.quality_scores.fidelity.passed).toBe(true)
    expect(output.quality_scores.style.passed).toBe(false)
    expect(output.quality_scores.overall.validated).toBe(false)
  })

  it('surfaces the repair summary when a chunk needed a targeted fact repair', async () => {
    process.env.MOCK_DETECTION_FIXTURE = 'human'
    const detection = await tryClassifyOutput('Some humanized output text.', 'test-user', 'free')
    const repairedChunk = chunk({ repair: { attempted: true, strategy: 'sentence_repair', succeeded: true, sentencesRepaired: 2 } })
    const output = buildOutput('Some humanized output text.', [repairedChunk], generateWatermark('job-8', 'gpt-4o-mini'), detection)

    expect(output.quality_scores.repair).toEqual({ attempted: true, succeeded: true, sentences_repaired: 2 })
  })

  it('surfaces claim_verification and relation_repair from Phase 7', async () => {
    process.env.MOCK_DETECTION_FIXTURE = 'human'
    const detection = await tryClassifyOutput('Some humanized output text.', 'test-user', 'free')
    const claimCheckedChunk = chunk({
      claimVerification: { checked: 3, failed: 1, issues: ['causal direction reversed'] },
      relationRepair: { attempted: true, strategy: 'restore_relations', succeeded: true, sentencesRepaired: 1 },
    })
    const output = buildOutput('Some humanized output text.', [claimCheckedChunk], generateWatermark('job-9', 'gpt-4o-mini'), detection)

    expect(output.quality_scores.fidelity.claim_verification).toEqual({ checked: 3, failed: 1, issues: ['causal direction reversed'] })
    expect(output.quality_scores.relation_repair).toEqual({ attempted: true, succeeded: true, sentences_repaired: 1 })
  })

  it('reports claim_verification as all-zero when the check never ran for any chunk', async () => {
    process.env.MOCK_DETECTION_FIXTURE = 'human'
    const detection = await tryClassifyOutput('Some humanized output text.', 'test-user', 'free')
    const output = buildOutput('Some humanized output text.', [chunk()], generateWatermark('job-10', 'gpt-4o-mini'), detection)

    expect(output.quality_scores.fidelity.claim_verification).toEqual({ checked: 0, failed: 0, issues: [] })
    expect(output.quality_scores.relation_repair).toEqual({ attempted: false, succeeded: false, sentences_repaired: 0 })
  })
})

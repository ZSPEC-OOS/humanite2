import { describe, it, expect, afterEach } from 'vitest'
import { buildOutput, tryClassifyOutput } from '@/lib/humanizeOutput'
import { generateWatermark } from '@/lib/watermark'
import { resetDetectionGatewayForTests } from '@/lib/detection/gateway'
import type { ChunkResult } from '@/lib/humanizePipeline'

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
    gate: { semantic_similarity: 0.94, nli_entailment: 0.97, entity_overlap: 1, passed: true, failed_gate: null, missing_facts: [], entailment_issues: [], preservation_by_type: {} },
    gatesUnavailable: false,
    retryCount: 0,
    ...overrides,
  }
}

describe('humanize route: detection integration (spec §30, §48)', () => {
  afterEach(resetEnv)

  it('humanization succeeds even when detection fails — never propagates the failure', async () => {
    process.env.MOCK_DETECTION_FIXTURE = 'rate-limit'
    const detection = await tryClassifyOutput('Some humanized output text.')
    expect(detection).toBeNull()

    const watermark = generateWatermark('job-1', 'gpt-4o-mini')
    const output = buildOutput('Some humanized output text.', [chunk()], watermark, detection)

    expect(output.text).toBe('Some humanized output text.')
    expect(output.detection).toBeNull()
    expect(output.detection_warning).toBe('AI detection unavailable')
    // The rest of the output is unaffected — quality scores and watermark
    // are fully populated regardless of what happened to detection.
    expect(output.quality_scores.passed).toBe(true)
    expect(output.watermark.job_id).toBe('job-1')
  })

  it('an ai-generated detection result threads through with no warning', async () => {
    process.env.MOCK_DETECTION_FIXTURE = 'ai'
    const detection = await tryClassifyOutput('Some humanized output text.')
    const output = buildOutput('Some humanized output text.', [chunk()], generateWatermark('job-2', 'gpt-4o-mini'), detection)

    expect(output.detection?.classification).toBe('ai-generated')
    expect(output.detection_warning).toBeNull()
  })

  it('a human-written detection result threads through with no warning', async () => {
    process.env.MOCK_DETECTION_FIXTURE = 'human'
    const detection = await tryClassifyOutput('Some humanized output text.')
    const output = buildOutput('Some humanized output text.', [chunk()], generateWatermark('job-3', 'gpt-4o-mini'), detection)

    expect(output.detection?.classification).toBe('human-written')
    expect(output.detection_warning).toBeNull()
  })

  it('a mixed detection result threads through with no warning', async () => {
    process.env.MOCK_DETECTION_FIXTURE = 'mixed'
    const detection = await tryClassifyOutput('Some humanized output text.')
    const output = buildOutput('Some humanized output text.', [chunk()], generateWatermark('job-4', 'gpt-4o-mini'), detection)

    expect(output.detection?.classification).toBe('mixed')
    expect(output.detection_warning).toBeNull()
  })

  it('large document: aggregates multiple chunks alongside a single whole-document detection result', async () => {
    process.env.MOCK_DETECTION_FIXTURE = 'human'
    const detection = await tryClassifyOutput('Chunk one. Chunk two. Chunk three.')

    const chunks = [
      chunk({ text: 'Chunk one.', substitutions: 2, retryCount: 1 }),
      chunk({ text: 'Chunk two.', substitutions: 0, retryCount: 0 }),
      chunk({ text: 'Chunk three.', substitutions: 3, retryCount: 1, gate: { semantic_similarity: 0.7, nli_entailment: 0.8, entity_overlap: 0.9, passed: false, failed_gate: 'semantic_similarity', missing_facts: [], entailment_issues: ['drift'], preservation_by_type: {} } }),
    ]
    const postText = chunks.map(c => c.text).join('\n\n')
    const output = buildOutput(postText, chunks, generateWatermark('job-5', 'gpt-4o-mini'), detection)

    // Detection ran once against the whole assembled document, not per chunk.
    expect(output.detection?.classification).toBe('human-written')
    // Chunk-level results still aggregate correctly across the whole document.
    expect(output.postprocessor_substitutions).toBe(5)
    expect(output.quality_scores.retry_count).toBe(2)
    expect(output.quality_scores.passed).toBe(false)
    expect(output.quality_scores.failed_gate).toBe('semantic_similarity')
  })
})

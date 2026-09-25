import { generateWatermark } from '@/lib/watermark'
import { aggregateChunkResults, ChunkResult } from '@/lib/humanizePipeline'
import { getDetectionGateway } from '@/lib/detection/gateway'
import { detectWithCache } from '@/lib/detection/dedupe'
import { DetectionResult } from '@/lib/detection/contracts'
import { recordScanTelemetry } from '@/lib/observability/scanTelemetry'
import { checkAndRecordScanUsage } from '@/lib/usageLimits'

export function buildOutput(
  postText: string,
  results: ChunkResult[],
  watermark: ReturnType<typeof generateWatermark>,
  detection: DetectionResult | null,
) {
  const agg = aggregateChunkResults(results)
  return {
    text: postText,
    quality_scores: {
      semantic_similarity: agg.semantic_similarity,
      nli_entailment: agg.nli_entailment,
      entity_overlap: agg.entity_overlap,
      passed: agg.passed,
      failed_gate: agg.failed_gate,
      degraded: agg.degraded,
      gates_available: agg.gates_available,
      retry_count: agg.retry_count,
      missing_facts: agg.missing_facts,
      entailment_issues: agg.entailment_issues,
      preservation_by_type: agg.preservation_by_type,
    },
    detection,
    // Distinguishes "not analyzed" (detection is null, this is set) from a
    // real "uncertain" classification (detection is populated) — the UI
    // should not conflate the two.
    detection_warning: detection ? null : 'AI detection unavailable',
    watermark,
    postprocessor_substitutions: results.reduce((sum, r) => sum + r.substitutions, 0),
  }
}

// Best-effort — a detection failure (custom endpoint hiccup, rate limit)
// should never break the humanize response itself. Runs once against the
// final assembled text rather than per-chunk: cheaper, and detectors read
// documents holistically rather than fragment-by-fragment anyway.
//
// Deliberately does not take the humanizer's OpenAI client/model: the
// detector is an independent service and must not be gradeable by (or
// dependent on) whatever model produced the text it's scanning. It does
// accept the caller's own GPTZero key (from api_config.gptzero_api_key),
// threaded straight through to getDetectionGateway() — see gateway.ts.
//
// This auto-scan spends the deployment's own GPTZero budget exactly like an
// explicit /v1/scan call does, so it draws from the same scan quota (see
// checkAndRecordScanUsage in usageLimits.ts) — skipped entirely for a caller
// using their own GPTZero key, same precedence as the generation quota.
// A plan with no scan quota (or one that's exhausted for today) simply gets
// no auto-scan on this humanize call, same as any other detection failure:
// output is never blocked on it.
export async function tryClassifyOutput(text: string, userId: string, tier: string, gptzeroApiKey?: string): Promise<DetectionResult | null> {
  const words = text.trim() ? text.trim().split(/\s+/).length : 0
  recordScanTelemetry({ event: 'scan_requested', trigger: 'auto', words, chars: text.length })

  if (!gptzeroApiKey) {
    const usage = await checkAndRecordScanUsage(userId, tier, words)
    if (!usage.allowed) {
      recordScanTelemetry({ event: 'scan_failed', trigger: 'auto', error_code: usage.code ?? 'LIMIT_EXCEEDED' })
      return null
    }
  }

  try {
    // Sent to the detector exactly as /v1/scan now sends its own input (see
    // the note there) — both routes must pass detectWithCache the identical
    // string for identical text, or a manual re-check of freshly humanized
    // text stops being a cache hit and becomes a second paid GPTZero call.
    const gateway = getDetectionGateway(gptzeroApiKey)
    const { result, cacheHit } = await detectWithCache(gateway, text, { mode: 'standard' }, !!gptzeroApiKey)

    recordScanTelemetry({
      event: 'scan_completed',
      trigger: 'auto',
      provider: result.provider.id,
      classification: result.classification,
      confidence_category: result.confidence_category,
      cache_hit: cacheHit,
      duration_ms: cacheHit ? 0 : result.processing_duration_ms,
    })
    // A cache hit didn't redo the detection work this call — report the
    // (near-zero) lookup time, not the original call's duration.
    return cacheHit ? { ...result, processing_duration_ms: 0 } : result
  } catch (err) {
    const code = err instanceof Error && 'code' in err ? String((err as { code: unknown }).code) : 'UNKNOWN_ERROR'
    recordScanTelemetry({ event: 'scan_failed', trigger: 'auto', error_code: code })
    console.warn('Post-humanize detection scan failed — shipping without it', {
      type: err instanceof Error ? err.constructor.name : typeof err,
    })
    return null
  }
}

import { generateWatermark } from '@/lib/watermark'
import { aggregateChunkResults, ChunkResult } from '@/lib/humanizePipeline'
import { getDetectionGateway } from '@/lib/detection/gateway'
import { detectWithCache } from '@/lib/detection/dedupe'
import { preprocess } from '@/lib/preprocess'
import { DetectionResult } from '@/lib/detection/contracts'
import { recordScanTelemetry } from '@/lib/observability/scanTelemetry'

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
      bertscore_f1: agg.bertscore_f1,
      nli_entailment: agg.nli_entailment,
      entity_overlap: agg.entity_overlap,
      passed: agg.passed,
      failed_gate: agg.failed_gate,
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
export async function tryClassifyOutput(text: string, gptzeroApiKey?: string): Promise<DetectionResult | null> {
  const words = text.trim() ? text.trim().split(/\s+/).length : 0
  recordScanTelemetry({ event: 'scan_requested', trigger: 'auto', words, chars: text.length })

  try {
    // Sanitized the same way /v1/scan sanitizes its input, so the two
    // routes compute the identical cache key for the same underlying text
    // — a manual re-check of freshly humanized text is a cache hit instead
    // of a second paid GPTZero call.
    const sanitized = preprocess(text).sanitized_text
    const gateway = getDetectionGateway(gptzeroApiKey)
    const { result, cacheHit } = await detectWithCache(gateway, sanitized, { mode: 'standard' }, !!gptzeroApiKey)

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

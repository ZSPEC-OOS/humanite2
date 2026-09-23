import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { randomUUID, createHash } from 'crypto'
import { waitUntil } from '@vercel/functions'
import { db, tryPersist } from '@/lib/firestore'
import { requireAuth, isAuthFailure } from '@/lib/require-auth'
import { preprocess, FactLock } from '@/lib/preprocess'
import { generateWatermark } from '@/lib/watermark'
import { chunkFactLockedText } from '@/lib/chunk'
import { humanizeChunk, aggregateChunkResults, ChunkResult } from '@/lib/humanizePipeline'
import { SYNC_MAX_CHARS, ASYNC_MAX_CHARS } from '@/lib/limits'
import { classify } from '@/lib/detection/client'
import { ClassifyResult } from '@/lib/detection/contracts'

// Vercel clamps this to whatever the deployment's plan actually allows
// (Hobby's ceiling is well under this) — raise it in the dashboard/CLI to
// match, or ASYNC_MAX_CHARS effectively shrinks to fit the plan.
export const maxDuration = 300

// Slow path: chunked, processed after the response is sent (see waitUntil
// below), polled via GET /v1/jobs/[jobId]. ASYNC_MAX_CHARS is chosen so the
// total chunk count comfortably finishes inside maxDuration even with
// retries — not a hard technical limit, just an untested-past-this-point line.
//
// Sized for a large-context model (deepseek-flash's ~1M-token window handles
// a chunk this size with enormous headroom) — the ceiling here is really
// "how much can finish inside maxDuration=300s", not the model's context
// limit. A small/slow model configured via api_config will take longer per
// chunk than this was tuned for.
const CHUNK_MAX_CHARS = 24_000
const MAX_GATE_RETRIES = 2

interface HumanizeSettings {
  intensity: number
  tone: string
  domain: string
}

interface ApiConfig {
  api_key?: string
  model_id?: string
  base_url?: string
}

function buildOutput(
  postText: string,
  results: ChunkResult[],
  watermark: ReturnType<typeof generateWatermark>,
  detection: ClassifyResult | null,
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
// dependent on) whatever model produced the text it's scanning.
async function tryClassifyOutput(text: string): Promise<ClassifyResult | null> {
  try {
    return await classify(text, 'standard')
  } catch (err) {
    console.warn('Post-humanize detection scan failed — shipping without it', {
      type: err instanceof Error ? err.constructor.name : typeof err,
    })
    return null
  }
}

// ── Async background processing ──────────────────────────────────────────────
// Kicked off via waitUntil after the "pending" response is already sent. On
// Vercel this keeps the serverless invocation alive past the response; on a
// long-running Node server it's a no-op wrapper — the promise just runs.

async function processHumanizeJobAsync(
  jobId: string,
  sanitizedText: string,
  factLocks: FactLock[],
  settings: HumanizeSettings,
  apiCfg: ApiConfig | undefined,
) {
  try {
    const client = new OpenAI({
      apiKey: apiCfg?.api_key || process.env.OPENAI_API_KEY,
      baseURL: apiCfg?.base_url || process.env.OPENAI_BASE_URL,
    })
    const model = apiCfg?.model_id || process.env.OPENAI_MODEL || 'gpt-4o-mini'
    const start = Date.now()
    const chunks = chunkFactLockedText(sanitizedText, factLocks, CHUNK_MAX_CHARS)

    const results: ChunkResult[] = []
    for (const chunk of chunks) {
      const result = await humanizeChunk(
        client, model, chunk.text, chunk.text, chunk.factLocks,
        settings.intensity, settings.tone, settings.domain, MAX_GATE_RETRIES,
      )
      results.push(result)

      // Persist after every chunk, not just at the end — if the function gets
      // killed for exceeding maxDuration partway through a long document, the
      // chunks that DID finish are recoverable instead of silently lost (the
      // catch block below never runs on a hard platform-level timeout). Same
      // output shape as the final result so the client can treat a recovered
      // partial identically to a completed one.
      const partialWatermark = generateWatermark(jobId, results.at(-1)!.modelUsed)
      await tryPersist(() => db().collection('jobs').doc(jobId).update({
        updatedAt: new Date(),
        progress: { chunks_completed: results.length, chunks_total: chunks.length },
        partialResult: {
          // Detection is skipped on partial saves (only meaningful once —
          // and cost-wise, once — on the final assembled text below).
          output: buildOutput(results.map(r => r.text).join('\n\n'), results, partialWatermark, null),
        },
      }), 'persist humanize job progress')
    }

    const postText = results.map(r => r.text).join('\n\n')
    const modelUsed = results.at(-1)?.modelUsed ?? model
    const watermark = generateWatermark(jobId, modelUsed)
    const detection = await tryClassifyOutput(postText)
    const output = buildOutput(postText, results, watermark, detection)
    const durationMs = Date.now() - start

    await tryPersist(() => db().collection('jobs').doc(jobId).update({
      status: 'completed',
      completedAt: new Date(),
      updatedAt: new Date(),
      watermarkFingerprint: watermark.fingerprint,
      result: {
        output,
        processing_metadata: {
          model_used: modelUsed,
          provider_used: 'openai',
          processing_duration_ms: durationMs,
          chunk_count: chunks.length,
        },
      },
    }), 'complete async humanize job')
  } catch (err) {
    console.error('Async humanize job failed', {
      jobId,
      type: err instanceof Error ? err.constructor.name : typeof err,
    })
    await tryPersist(() => db().collection('jobs').doc(jobId).update({
      status: 'failed',
      errorCode: 'INTERNAL_PIPELINE_ERROR',
      errorType: err instanceof Error ? err.constructor.name : 'UnknownError',
      updatedAt: new Date(),
    }), 'mark async humanize job failed')
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if (isAuthFailure(auth)) return auth

  let body: {
    text?: string
    settings?: { intensity?: number; tone?: string; domain?: string; preserve_citations?: boolean }
    api_config?: ApiConfig
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } },
      { status: 400 },
    )
  }

  const text = (body.text ?? '').trim()
  const settingsIn = body.settings ?? {}
  const intensity = Math.min(10, Math.max(1, settingsIn.intensity ?? 5))
  const tone = settingsIn.tone ?? 'balanced'
  const domain = settingsIn.domain ?? 'general'
  const settings: HumanizeSettings = { intensity, tone, domain }

  if (text.length < 20) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_MIN_LENGTH', message: 'Text must be at least 20 characters.' } },
      { status: 400 },
    )
  }
  if (text.length > ASYNC_MAX_CHARS) {
    return NextResponse.json(
      {
        error: {
          code: 'VALIDATION_MAX_LENGTH',
          message: `Text exceeds the ${ASYNC_MAX_CHARS.toLocaleString()} character limit.`,
        },
      },
      { status: 422 },
    )
  }

  const prep = preprocess(text)

  const jobId = randomUUID()
  const inputHash = createHash('sha256').update(text).digest('hex')
  const now = new Date()

  const jobPersisted = await tryPersist(() => db().collection('jobs').doc(jobId).set({
    userId: auth.claims.sub,
    jobType: 'humanize',
    status: 'processing',
    inputTextHash: inputHash,
    settings,
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    errorCode: null,
  }), 'create humanize job')

  // ── Long document: hand off to the background and answer immediately ──────
  if (text.length > SYNC_MAX_CHARS) {
    // The only channel back to the client for an async job is polling the
    // job record — if we couldn't even create it, there is no way to ever
    // report a result, so fail fast instead of accepting work we can't return.
    if (!jobPersisted) {
      return NextResponse.json(
        {
          error: {
            code: 'STORAGE_UNAVAILABLE',
            message: `Background processing requires job storage, which is currently unavailable. Configure Firebase credentials, or submit text under the ${SYNC_MAX_CHARS.toLocaleString()}-character synchronous limit.`,
          },
        },
        { status: 503 },
      )
    }
    waitUntil(processHumanizeJobAsync(jobId, prep.sanitized_text, prep.fact_locks, settings, body.api_config))
    return NextResponse.json({
      job_id: jobId,
      status: 'pending',
      output: null,
      preprocessing_metadata: {
        language: prep.language,
        word_count: prep.word_count,
        char_count: prep.char_count,
        fact_lock_count: prep.fact_locks.length,
        ai_signal_strength: 0,
      },
      processing_metadata: null,
      result_url: `/v1/jobs/${jobId}`,
      warning: 'Text queued for background processing — poll result_url for completion.',
    })
  }

  // ── Short document: process synchronously within this request ─────────────
  try {
    const apiCfg = body.api_config
    const client = new OpenAI({
      apiKey: apiCfg?.api_key || process.env.OPENAI_API_KEY,
      baseURL: apiCfg?.base_url || process.env.OPENAI_BASE_URL,
    })
    const model = apiCfg?.model_id || process.env.OPENAI_MODEL || 'gpt-4o-mini'
    const start = Date.now()

    const result = await humanizeChunk(
      client, model, text, prep.sanitized_text, prep.fact_locks,
      intensity, tone, domain, MAX_GATE_RETRIES,
    )
    const durationMs = Date.now() - start

    const watermark = generateWatermark(jobId, result.modelUsed)
    const detection = await tryClassifyOutput(result.text)
    const output = buildOutput(result.text, [result], watermark, detection)

    await tryPersist(() => db().collection('jobs').doc(jobId).update({
      status: 'completed',
      completedAt: new Date(),
      updatedAt: new Date(),
      watermarkFingerprint: watermark.fingerprint,
    }), 'complete humanize job')

    return NextResponse.json({
      job_id: jobId,
      status: 'completed',
      output,
      preprocessing_metadata: {
        language: prep.language,
        word_count: prep.word_count,
        char_count: prep.char_count,
        fact_lock_count: prep.fact_locks.length,
        ai_signal_strength: 0,
      },
      processing_metadata: {
        model_used: result.modelUsed,
        provider_used: 'openai',
        processing_duration_ms: durationMs,
      },
      result_url: null,
      warning: result.gatesUnavailable
        ? 'Quality gates could not run against the configured model endpoint — output is unscored.'
        : null,
    })
  } catch (err) {
    await tryPersist(() => db().collection('jobs').doc(jobId).update({ status: 'failed', errorCode: 'INTERNAL_PIPELINE_ERROR', updatedAt: new Date() }), 'mark humanize job failed')
    console.error('Humanize failed', { jobId, err })
    return NextResponse.json(
      { error: { code: 'DEPENDENCY_UPSTREAM_ERROR', message: 'An upstream service failed. Please retry.' } },
      { status: 502 },
    )
  }
}

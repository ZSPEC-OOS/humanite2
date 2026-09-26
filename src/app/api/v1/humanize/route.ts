import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { randomUUID, createHash } from 'crypto'
import { waitUntil } from '@vercel/functions'
import { db, tryPersist } from '@/lib/firestore'
import { requireAuth, isAuthFailure } from '@/lib/require-auth'
import { preprocess, FactLock } from '@/lib/preprocess'
import { generateWatermark, hashContent } from '@/lib/watermark'
import { chunkFactLockedText } from '@/lib/chunk'
import { humanizeChunk, ChunkResult, joinChunkResults } from '@/lib/humanizePipeline'
import { toValidDomain, toValidGenre, toValidAudience } from '@/lib/style'
import { buildDocumentContext, emptyDocumentContext, runDocumentConsistencyPass, type DocumentContext } from '@/lib/document'
import { effectiveIntensity } from '@/lib/intensity'
import { SYNC_MAX_CHARS, ASYNC_MAX_CHARS } from '@/lib/limits'
import { buildOutput, tryClassifyOutput } from '@/lib/humanizeOutput'
import { checkAndRecordGenerationUsage } from '@/lib/usageLimits'
import { getUserApiConfig } from '@/lib/userApiConfig'
import { resolveProvider } from '@/lib/providerResolution'
import { saveTransformation } from '@/lib/transformations'
import type { StoredApiConfig } from '@/lib/r2'

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
// limit. A small/slow model configured via the caller's saved config will
// take longer per chunk than this was tuned for.
const CHUNK_MAX_CHARS = 24_000
const MAX_GATE_RETRIES = 2

interface HumanizeSettings {
  intensity: number
  tone: string
  domain: string
  genre: string | null
  audience: string | null
}

// Best-effort — a document without unusual terminology, abbreviations, or
// section structure gets no less service from this failing than from
// succeeding; see buildDocumentContext's own budget note (capped analysis
// text, capped extraction counts) for why this stays a single call rather
// than something worth retrying.
async function buildDocumentContextSafely(
  client: OpenAI,
  model: string,
  sourceText: string,
  genre: string | null,
  audience: string | null,
): Promise<DocumentContext> {
  const validGenre = toValidGenre(genre)
  const validAudience = toValidAudience(audience)
  try {
    return await buildDocumentContext(client, model, sourceText, validGenre, validAudience)
  } catch (err) {
    console.warn('Document context analysis unavailable, continuing without cross-chunk consistency data', {
      type: err instanceof Error ? err.constructor.name : typeof err,
    })
    return emptyDocumentContext(validGenre, validAudience)
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
  userConfig: StoredApiConfig | null,
  userId: string,
  tier: string,
  originalText: string,
) {
  try {
    const { apiKey, baseURL, model } = resolveProvider(userConfig)
    const client = new OpenAI({ apiKey, baseURL })
    const start = Date.now()
    const chunks = chunkFactLockedText(sanitizedText, factLocks, CHUNK_MAX_CHARS)
    const documentContext = await buildDocumentContextSafely(client, model, sanitizedText, settings.genre, settings.audience)

    const results: ChunkResult[] = []
    for (const chunk of chunks) {
      const result = await humanizeChunk(
        client, model, chunk.text, chunk.text, chunk.factLocks,
        settings.intensity, settings.tone, settings.domain, MAX_GATE_RETRIES,
        settings.genre, settings.audience, documentContext,
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
          output: buildOutput(joinChunkResults(results, chunks), results, partialWatermark, null),
        },
      }), 'persist humanize job progress')
    }

    const joinedText = joinChunkResults(results, chunks)
    const consistency = await runDocumentConsistencyPass(client, model, joinedText, documentContext, results.map(r => r.text))
    const postText = consistency.text
    const modelUsed = results.at(-1)?.modelUsed ?? model
    const watermark = generateWatermark(jobId, modelUsed)
    const detection = await tryClassifyOutput(postText, userId, tier, userConfig?.gptzeroApiKey || undefined)
    const output = buildOutput(postText, results, watermark, detection, consistency)
    const durationMs = Date.now() - start

    await saveTransformation({ jobId, userId, inputText: originalText, output, modelUsed })

    await tryPersist(() => db().collection('jobs').doc(jobId).update({
      status: 'completed',
      completedAt: new Date(),
      updatedAt: new Date(),
      watermarkFingerprint: watermark.fingerprint,
      contentHash: hashContent(postText),
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
    settings?: { intensity?: number; tone?: string; domain?: string; genre?: string | null; audience?: string | null }
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
  const requestedIntensity = Math.min(10, Math.max(1, settingsIn.intensity ?? 5))
  const tone = settingsIn.tone ?? 'balanced'
  const domain = settingsIn.domain ?? 'general'
  // "Effective intensity = min(requested, domain cap)" — the pipeline is
  // always driven by `.applied`, never the raw requested value, so a
  // domain like legal or medical never receives a rewrite instruction
  // stronger than its preservation rules can tolerate.
  const intensity = effectiveIntensity(requestedIntensity, toValidDomain(domain))
  const genre = settingsIn.genre ?? null
  const audience = settingsIn.audience ?? null
  const settings: HumanizeSettings = { intensity: intensity.applied, tone, domain, genre, audience }

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

  // The caller's own saved model config, if any — looked up server-side by
  // their authenticated identity rather than trusted from the request body.
  // The browser doesn't hold (or send) the raw key at all; see
  // apiConfigStore.ts and ApiConfigModal.tsx.
  const userConfig = await getUserApiConfig(auth.claims.sub)

  // Skipped entirely for a caller using their own generation key — this
  // quota exists to protect this deployment's own paid OPENAI_API_KEY, not
  // to restrict usage of a key that isn't this deployment's to pay for.
  if (!userConfig?.apiKey) {
    const usage = await checkAndRecordGenerationUsage(auth.claims.sub, auth.claims.tier, prep.word_count, auth.claims.email_hash)
    if (!usage.allowed) {
      return NextResponse.json(
        { error: { code: usage.code === 'UNAVAILABLE' ? 'USAGE_TRACKING_UNAVAILABLE' : 'USAGE_LIMIT_EXCEEDED', message: usage.reason } },
        { status: usage.code === 'UNAVAILABLE' ? 503 : 429 },
      )
    }
  }

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
    waitUntil(processHumanizeJobAsync(jobId, prep.sanitized_text, prep.fact_locks, settings, userConfig, auth.claims.sub, auth.claims.tier, text))
    return NextResponse.json({
      job_id: jobId,
      status: 'pending',
      output: null,
      preprocessing_metadata: {
        language: prep.language,
        word_count: prep.word_count,
        char_count: prep.char_count,
        fact_lock_count: prep.fact_locks.length,
      },
      intensity,
      processing_metadata: null,
      result_url: `/v1/jobs/${jobId}`,
      warning: 'Text queued for background processing — poll result_url for completion.',
    })
  }

  // ── Short document: process synchronously within this request ─────────────
  try {
    const { apiKey, baseURL, model } = resolveProvider(userConfig)
    const client = new OpenAI({ apiKey, baseURL })
    const start = Date.now()
    const documentContext = await buildDocumentContextSafely(client, model, prep.sanitized_text, genre, audience)

    const result = await humanizeChunk(
      client, model, text, prep.sanitized_text, prep.fact_locks,
      intensity.applied, tone, domain, MAX_GATE_RETRIES,
      genre, audience, documentContext,
    )
    const consistency = await runDocumentConsistencyPass(client, model, result.text, documentContext, [result.text])
    const finalText = consistency.text
    const durationMs = Date.now() - start

    const watermark = generateWatermark(jobId, result.modelUsed)
    const detection = await tryClassifyOutput(finalText, auth.claims.sub, auth.claims.tier, userConfig?.gptzeroApiKey || undefined)
    const output = buildOutput(finalText, [result], watermark, detection, consistency)

    await saveTransformation({ jobId, userId: auth.claims.sub, inputText: text, output, modelUsed: result.modelUsed })

    await tryPersist(() => db().collection('jobs').doc(jobId).update({
      status: 'completed',
      completedAt: new Date(),
      updatedAt: new Date(),
      watermarkFingerprint: watermark.fingerprint,
      contentHash: hashContent(finalText),
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
      },
      intensity,
      processing_metadata: {
        model_used: result.modelUsed,
        provider_used: 'openai',
        processing_duration_ms: durationMs,
      },
      result_url: null,
      warning: output.quality_scores.overall.degraded
        ? 'Some quality checks could not run against the configured model endpoint — output may be under-scored.'
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

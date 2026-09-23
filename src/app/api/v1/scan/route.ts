import { NextRequest, NextResponse } from 'next/server'
import { randomUUID, createHash } from 'crypto'
import { db, tryPersist } from '@/lib/firestore'
import { requireAuth, isAuthFailure } from '@/lib/require-auth'
import { preprocess } from '@/lib/preprocess'
import { getDetectionGateway } from '@/lib/detection/gateway'
import { detectWithCache } from '@/lib/detection/dedupe'
import { DetectionProviderError } from '@/lib/detection/contracts'
import { recordScanTelemetry } from '@/lib/observability/scanTelemetry'
import { checkAndRecordUsage } from '@/lib/usageLimits'

// A single non-chunked detection call through DetectionGateway.
export const maxDuration = 60

const ABSOLUTE_MAX_CHARS = 300_000
// Rules out a single short sentence outright — a harder floor than the
// reliability warning in DetectionGateway.detect(), which still returns a
// result (with a caveat) for anything under its own, higher word threshold.
const ABSOLUTE_MIN_CHARS = 100

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if (isAuthFailure(auth)) return auth

  let body: { text?: string; mode?: string; domain_hint?: string; api_config?: { gptzero_api_key?: string } }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } },
      { status: 400 },
    )
  }

  const text = (body.text ?? '').trim()
  const mode = body.mode === 'quick' ? 'quick' : 'standard'

  if (text.length < ABSOLUTE_MIN_CHARS) {
    return NextResponse.json(
      {
        error: {
          code: 'VALIDATION_MIN_LENGTH',
          message: `Text must be at least ${ABSOLUTE_MIN_CHARS} characters — AI detection isn't reliable on anything shorter.`,
        },
      },
      { status: 400 },
    )
  }
  if (text.length > ABSOLUTE_MAX_CHARS) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_MAX_LENGTH', message: `Text exceeds the ${ABSOLUTE_MAX_CHARS.toLocaleString()} character limit.` } },
      { status: 413 },
    )
  }

  // Normalization only — the scanner analyzes text as data, so content that
  // merely resembles markup (e.g. a document discussing <script> tags) is
  // not rejected outright, only normalized (stripped tags, collapsed
  // whitespace). See lib/preprocess.ts.
  const sanitized = preprocess(text).sanitized_text

  const jobId = randomUUID()
  const scanId = randomUUID()
  const inputHash = createHash('sha256').update(text).digest('hex')
  const now = new Date()
  const wordCount = sanitized.split(/\s+/).filter(Boolean).length

  // Skipped entirely for a caller using their own GPTZero key — see the
  // identical note in humanize/route.ts.
  if (!body.api_config?.gptzero_api_key) {
    const usage = await checkAndRecordUsage(auth.claims.sub, auth.claims.tier, wordCount)
    if (!usage.allowed) {
      return NextResponse.json(
        { error: { code: 'USAGE_LIMIT_EXCEEDED', message: usage.reason } },
        { status: 429 },
      )
    }
  }

  await tryPersist(() => db().collection('jobs').doc(jobId).set({
    userId: auth.claims.sub,
    jobType: 'scan',
    status: 'processing',
    inputTextHash: inputHash,
    inputChars: sanitized.length,
    inputWords: wordCount,
    settings: { mode },
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    errorCode: null,
  }), 'create scan job')

  recordScanTelemetry({ event: 'scan_requested', trigger: 'manual', words: wordCount, chars: sanitized.length })

  try {
    const userGptzeroKey = body.api_config?.gptzero_api_key?.trim() || undefined
    const gateway = getDetectionGateway(userGptzeroKey)
    const { result: detectionResult, cacheHit } = await detectWithCache(
      gateway,
      sanitized,
      { mode, domainHint: body.domain_hint || 'general' },
      !!userGptzeroKey,
    )

    await tryPersist(() => db().collection('jobs').doc(jobId).update({
      status: 'completed',
      completedAt: new Date(),
      updatedAt: new Date(),
      provider: detectionResult.provider.id,
      cacheHit,
      result: {
        classification: detectionResult.classification,
        predicted_class_probability: detectionResult.predicted_class_probability,
        confidence_category: detectionResult.confidence_category,
      },
    }), 'complete scan job')

    recordScanTelemetry({
      event: 'scan_completed',
      trigger: 'manual',
      provider: detectionResult.provider.id,
      classification: detectionResult.classification,
      confidence_category: detectionResult.confidence_category,
      cache_hit: cacheHit,
      duration_ms: cacheHit ? 0 : detectionResult.processing_duration_ms,
    })

    return NextResponse.json({
      job_id: jobId,
      status: 'completed',
      scan_id: scanId,
      result_url: null,
      cache_hit: cacheHit,
      ...detectionResult,
      // A cache hit didn't redo the detection work this request — report
      // the (near-zero) lookup time, not the original call's duration.
      ...(cacheHit ? { processing_duration_ms: 0 } : {}),
    })
  } catch (err) {
    await tryPersist(() => db().collection('jobs').doc(jobId).update({ status: 'failed', errorCode: 'INTERNAL_PIPELINE_ERROR', updatedAt: new Date() }), 'mark scan job failed')
    console.error('Scan failed', { jobId, err })

    if (err instanceof DetectionProviderError) {
      const status =
        err.code === 'INVALID_INPUT' || err.code === 'TEXT_TOO_SHORT' || err.code === 'TEXT_TOO_LARGE' ? 400
        : err.code === 'PROVIDER_RATE_LIMITED' ? 429
        : 502
      recordScanTelemetry({ event: 'scan_failed', trigger: 'manual', error_code: err.code, http_status: status })
      return NextResponse.json({ error: { code: err.code, message: err.message } }, { status })
    }
    recordScanTelemetry({ event: 'scan_failed', trigger: 'manual', error_code: 'DEPENDENCY_UPSTREAM_ERROR', http_status: 502 })
    return NextResponse.json(
      { error: { code: 'DEPENDENCY_UPSTREAM_ERROR', message: 'An upstream service failed. Please retry.' } },
      { status: 502 },
    )
  }
}

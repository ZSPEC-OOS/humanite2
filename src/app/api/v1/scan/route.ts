import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { randomUUID, createHash } from 'crypto'
import { db, tryPersist } from '@/lib/firestore'
import { requireAuth, isAuthFailure } from '@/lib/require-auth'
import { preprocess } from '@/lib/preprocess'
import { classify } from '@/lib/detection'

// A single non-chunked classification call — raised to take advantage of
// large-context models (deepseek-flash's ~1M-token window), bounded by
// maxDuration below rather than the model's own ceiling.
export const maxDuration = 60

const ABSOLUTE_MAX_CHARS = 300_000

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if (isAuthFailure(auth)) return auth

  let body: { text?: string; mode?: string; domain_hint?: string; api_config?: { api_key?: string; model_id?: string; base_url?: string } }
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

  if (text.length < 20) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_MIN_LENGTH', message: 'Text must be at least 20 characters.' } },
      { status: 400 },
    )
  }
  if (text.length > ABSOLUTE_MAX_CHARS) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_MAX_LENGTH', message: `Text exceeds the ${ABSOLUTE_MAX_CHARS.toLocaleString()} character limit.` } },
      { status: 413 },
    )
  }

  let sanitized = text
  try {
    sanitized = preprocess(text).sanitized_text
  } catch {
    return NextResponse.json(
      { error: { code: 'VALIDATION_INJECTION_ATTEMPT', message: 'Input contains disallowed content.' } },
      { status: 400 },
    )
  }

  const jobId = randomUUID()
  const scanId = randomUUID()
  const inputHash = createHash('sha256').update(text).digest('hex')
  const now = new Date()

  await tryPersist(() => db().collection('jobs').doc(jobId).set({
    userId: auth.claims.sub,
    jobType: 'scan',
    status: 'processing',
    inputTextHash: inputHash,
    settings: { mode },
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    errorCode: null,
  }), 'create scan job')

  try {
    const apiCfg = body.api_config
    const client = new OpenAI({
      apiKey: apiCfg?.api_key || process.env.OPENAI_API_KEY,
      baseURL: apiCfg?.base_url || process.env.OPENAI_BASE_URL,
    })
    const model = apiCfg?.model_id || process.env.OPENAI_MODEL || 'gpt-4o-mini'

    const result = await classify(client, model, sanitized, mode)

    await tryPersist(() => db().collection('jobs').doc(jobId).update({ status: 'completed', completedAt: new Date(), updatedAt: new Date() }), 'complete scan job')

    return NextResponse.json({
      job_id: jobId,
      status: 'completed',
      scan_id: scanId,
      classification: result.classification,
      confidence: result.confidence,
      human_probability: result.human_probability,
      ai_probability: result.ai_probability,
      uncertain_probability: result.uncertain_probability,
      per_sentence_perplexity: [],
      top_features: result.top_features,
      explanation: result.explanation,
      model_used: result.model_used,
      processing_duration_ms: null,
      result_url: null,
      warning: null,
    })
  } catch (err) {
    await tryPersist(() => db().collection('jobs').doc(jobId).update({ status: 'failed', errorCode: 'INTERNAL_PIPELINE_ERROR', updatedAt: new Date() }), 'mark scan job failed')
    console.error('Scan failed', { jobId, err })
    return NextResponse.json(
      { error: { code: 'DEPENDENCY_UPSTREAM_ERROR', message: 'An upstream service failed. Please retry.' } },
      { status: 502 },
    )
  }
}

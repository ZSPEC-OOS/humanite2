import { createHash } from 'crypto'

// Points at this deployment's own /v1/verify route (see
// src/app/api/v1/verify/[fingerprint]/route.ts) — set NEXT_PUBLIC_APP_URL to
// the app's real deployed origin so exported documents carry a working link.
const VERIFICATION_BASE = `${process.env.NEXT_PUBLIC_APP_URL ?? ''}/api/v1/verify`

export function generateWatermark(jobId: string, model: string) {
  const salt = process.env.WATERMARK_SECRET_SALT ?? 'dev-salt-replace-in-production'
  const today = new Date().toISOString().slice(0, 10)
  const fingerprint = createHash('sha256')
    .update(`${jobId}:${model}:${today}:${salt}`)
    .digest('hex')

  return {
    type: 'ai_processed',
    fingerprint,
    job_id: jobId,
    model,
    verification_url: `${VERIFICATION_BASE}/${fingerprint}`,
    issued_at: new Date().toISOString(),
  }
}

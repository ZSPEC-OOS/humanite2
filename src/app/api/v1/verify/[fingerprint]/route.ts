import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/firestore'
import { hashContent } from '@/lib/watermark'

// Public — no auth. Lets anyone holding an exported document's watermark
// confirm it was produced by this service, without exposing the job's text,
// owner, or any other job metadata.

async function findJob(fingerprint: string) {
  const snap = await db()
    .collection('jobs')
    .where('watermarkFingerprint', '==', fingerprint)
    .limit(1)
    .get()
  return snap.empty ? null : snap.docs[0]!.data()
}

// Confirms only that a job with this fingerprint exists — not that any
// particular text is what it produced. Kept for backward compatibility with
// existing verification_url links; POST is the one that actually verifies
// content, see below.
export async function GET(req: NextRequest, { params }: { params: { fingerprint: string } }) {
  const job = await findJob(params.fingerprint)
  if (!job) {
    return NextResponse.json({ verified: false }, { status: 404 })
  }
  return NextResponse.json({
    verified: true,
    processed_at: job.completedAt ? job.completedAt.toDate().toISOString() : null,
  })
}

// Binds the fingerprint to the exact output text — a fingerprint alone
// (jobId:model:date:salt) never proved which text a job actually produced,
// only that a job with that ID existed. This compares a hash of the
// submitted text against the hash stored at job completion (never the text
// itself, so this stays consistent with GET's "no job text exposed" promise
// in both directions).
export async function POST(req: NextRequest, { params }: { params: { fingerprint: string } }) {
  let body: { text?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } },
      { status: 400 },
    )
  }

  const job = await findJob(params.fingerprint)
  if (!job) {
    return NextResponse.json({ verified: false, content_match: null }, { status: 404 })
  }

  const text = body.text ?? ''
  // A job completed before this field existed has no stored hash to compare
  // against — content_match reports "not checked", not a false "no match".
  const content_match = !text || !job.contentHash ? null : hashContent(text) === job.contentHash

  return NextResponse.json({
    verified: true,
    processed_at: job.completedAt ? job.completedAt.toDate().toISOString() : null,
    content_match,
  })
}

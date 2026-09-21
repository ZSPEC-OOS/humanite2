import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/firestore'

// Public — no auth. Lets anyone holding an exported document's watermark
// confirm it was produced by this service, without exposing the job's text,
// owner, or any other job metadata.
export async function GET(req: NextRequest, { params }: { params: { fingerprint: string } }) {
  const { fingerprint } = params

  const snap = await db()
    .collection('jobs')
    .where('watermarkFingerprint', '==', fingerprint)
    .limit(1)
    .get()

  if (snap.empty) {
    return NextResponse.json({ verified: false }, { status: 404 })
  }

  const job = snap.docs[0]!.data()
  return NextResponse.json({
    verified: true,
    processed_at: job.completedAt ? job.completedAt.toDate().toISOString() : null,
  })
}

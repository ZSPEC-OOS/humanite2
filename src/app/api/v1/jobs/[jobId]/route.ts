import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/firestore'
import { requireAuth, isAuthFailure } from '@/lib/require-auth'

export async function GET(req: NextRequest, { params }: { params: { jobId: string } }) {
  const auth = await requireAuth(req)
  if (isAuthFailure(auth)) return auth

  const jobDoc = await db().collection('jobs').doc(params.jobId).get()
  if (!jobDoc.exists) {
    return NextResponse.json({ error: { code: 'JOB_NOT_FOUND', message: 'Job not found.' } }, { status: 404 })
  }

  const job = jobDoc.data()!
  // Prevent enumeration — treat other users' jobs as not found
  if (job.userId !== auth.claims.sub) {
    return NextResponse.json({ error: { code: 'JOB_NOT_FOUND', message: 'Job not found.' } }, { status: 404 })
  }

  return NextResponse.json({
    job_id: jobDoc.id,
    job_type: job.jobType,
    status: job.status,
    created_at: job.createdAt.toDate().toISOString(),
    completed_at: job.completedAt ? job.completedAt.toDate().toISOString() : null,
    result_url: job.resultUrl ?? null,
    error_code: job.errorCode ?? null,
    output: job.result?.output ?? null,
    processing_metadata: job.result?.processing_metadata ?? null,
  })
}

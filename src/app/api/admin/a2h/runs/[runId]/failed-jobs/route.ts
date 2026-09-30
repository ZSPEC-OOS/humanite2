import { NextRequest, NextResponse } from 'next/server'
import { requireA2HAdmin } from '@/lib/require-a2h-admin'
import { isAuthFailure } from '@/lib/require-auth'
import { db } from '@/lib/firestore'
import { listJobsForRun } from '@/lib/a2h/jobs'

// Phase 5A (§41): the admin's drilldown view of exactly what's blocking a
// needs_attention run — read-only, no bulk action here (retrying happens
// through the dedicated retry-failed-jobs action, never a raw delete/edit).
export async function GET(req: NextRequest, { params }: { params: { runId: string } }) {
  const auth = await requireA2HAdmin(req)
  if (isAuthFailure(auth)) return auth

  const jobs = await listJobsForRun(db(), params.runId)
  const failedJobs = jobs.filter(j => j.status === 'failed')
  return NextResponse.json({ failedJobs })
}

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, isAuthFailure } from '@/lib/require-auth'
import { getUsageSummary } from '@/lib/usageLimits'

// Read-only — reports the caller's own current-period usage against their
// tier's quota (the same pools checkAndRecordGenerationUsage/
// checkAndRecordScanUsage meter). Used by the Developer dashboard's "Usage
// this month" card. Never records anything.
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (isAuthFailure(auth)) return auth

  const summary = await getUsageSummary(auth.claims.sub, auth.claims.tier, auth.claims.email_hash)
  return NextResponse.json(summary)
}

import { NextRequest, NextResponse } from 'next/server'
import { requireA2HAdmin } from '@/lib/require-a2h-admin'
import { isAuthFailure } from '@/lib/require-auth'
import { db } from '@/lib/firestore'
import { getUserApiConfig } from '@/lib/userApiConfig'
import { resolveProvider } from '@/lib/providerResolution'
import { validateRun, computeFixtureEligibility } from '@/lib/a2h/runs'

// Runs the full §24 precondition checklist and, only on success, freezes
// the selected source cohort into BenchmarkRunSource rows. Always returns
// 200 with the full error list on a failed validation — validation failing
// is an expected, actionable outcome, not a server error.
export async function POST(req: NextRequest, { params }: { params: { runId: string } }) {
  const auth = await requireA2HAdmin(req)
  if (isAuthFailure(auth)) return auth

  const userConfig = await getUserApiConfig(auth.claims.sub)
  const { apiKey } = resolveProvider(userConfig)
  const hasModelConfig = Boolean(apiKey)
  const hasDetectorConfig = Boolean(userConfig?.gptzeroApiKey)

  try {
    const { run, result } = await validateRun(db(), params.runId, { hasModelConfig, hasDetectorConfig })
    // §27: show fixture coverage before the run starts — only meaningful
    // once validation has snapshotted the cohort, so this is empty on a
    // failed validation.
    const eligibility = result.ok ? await computeFixtureEligibility(db(), run) : {}
    return NextResponse.json({ run, result, eligibility })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Validation failed.'
    const notFound = message === 'Benchmark run not found.'
    return NextResponse.json(
      { error: { code: notFound ? 'NOT_FOUND' : 'CONFLICT', message } },
      { status: notFound ? 404 : 409 },
    )
  }
}

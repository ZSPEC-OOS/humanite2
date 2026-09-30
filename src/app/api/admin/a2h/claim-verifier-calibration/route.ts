import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { requireA2HAdmin } from '@/lib/require-a2h-admin'
import { isAuthFailure } from '@/lib/require-auth'
import { db } from '@/lib/firestore'
import { getUserApiConfig } from '@/lib/userApiConfig'
import { resolveProvider } from '@/lib/providerResolution'
import { getClaimVerifierCalibration, getOrRunClaimVerifierCalibration } from '@/lib/a2h/claimVerifierCalibration'
import { DEFAULT_CLAIM_VERIFIER_CONFIG_VERSION } from '@/lib/a2h/a2h16'

// A2H-16's verifier-calibration subtest (§26-27) — deliberately NOT scoped to
// any corpus project or run: it measures the model-based claim verifier's
// own reliability against a fixed dataset (a2h16.ts's
// CLAIM_VERIFIER_CALIBRATION_SET), independent of anything a particular
// benchmark run does. Cached by verifierConfigVersion so a page load never
// implicitly re-triggers this paid call — POST with force=true is the only
// way to recompute it.

export async function GET(req: NextRequest) {
  const auth = await requireA2HAdmin(req)
  if (isAuthFailure(auth)) return auth

  const verifierConfigVersion = req.nextUrl.searchParams.get('verifierConfigVersion') || DEFAULT_CLAIM_VERIFIER_CONFIG_VERSION
  const result = await getClaimVerifierCalibration(db(), verifierConfigVersion)
  return NextResponse.json({ result })
}

export async function POST(req: NextRequest) {
  const auth = await requireA2HAdmin(req)
  if (isAuthFailure(auth)) return auth

  let body: { force?: boolean; verifierConfigVersion?: string } = {}
  try {
    body = await req.json()
  } catch {
    // An empty body is fine — force defaults to false.
  }

  const userConfig = await getUserApiConfig(auth.claims.sub)
  const { apiKey, baseURL, model } = resolveProvider(userConfig)
  if (!apiKey) {
    return NextResponse.json(
      { error: { code: 'NO_MODEL_CONFIGURED', message: 'Configure an AI model (Settings) before running verifier calibration.' } },
      { status: 422 },
    )
  }
  const client = new OpenAI({ apiKey, baseURL })
  const verifierConfigVersion = body.verifierConfigVersion || DEFAULT_CLAIM_VERIFIER_CONFIG_VERSION

  const result = await getOrRunClaimVerifierCalibration(db(), client, model, verifierConfigVersion, body.force === true)
  return NextResponse.json({ result })
}

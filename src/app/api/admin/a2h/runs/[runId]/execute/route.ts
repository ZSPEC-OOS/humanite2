import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { requireA2HAdmin } from '@/lib/require-a2h-admin'
import { isAuthFailure } from '@/lib/require-auth'
import { db } from '@/lib/firestore'
import { getUserApiConfig } from '@/lib/userApiConfig'
import { resolveProvider, resolvedProviderId } from '@/lib/providerResolution'
import { executeRunBatch, ExecutionConfigMismatchError } from '@/lib/a2h/execution'

// Advances one bounded batch of the run's queued work (§10/§11/§26) — the
// interactive equivalent of a worker picking a job off a queue, since this
// deployment has no background worker process. The UI calls this repeatedly
// until the run reports 'completed'; a call against a paused/cancelled/
// completed run is a safe no-op (see executeRunBatch).
export const maxDuration = 300

export async function POST(req: NextRequest, { params }: { params: { runId: string } }) {
  const auth = await requireA2HAdmin(req)
  if (isAuthFailure(auth)) return auth

  const userConfig = await getUserApiConfig(auth.claims.sub)
  const { apiKey, baseURL, model, usingByok } = resolveProvider(userConfig)
  if (!apiKey) {
    return NextResponse.json(
      { error: { code: 'NO_MODEL_CONFIGURED', message: 'Configure an AI model (Settings) before running a benchmark.' } },
      { status: 422 },
    )
  }
  const gptZeroApiKey = userConfig?.gptzeroApiKey
  if (!gptZeroApiKey) {
    return NextResponse.json(
      { error: { code: 'NO_DETECTOR_CONFIGURED', message: 'Configure a GPTZero API key (Settings) before running a benchmark.' } },
      { status: 422 },
    )
  }
  const client = new OpenAI({ apiKey, baseURL })

  try {
    const result = await executeRunBatch(db(), params.runId, {
      client,
      model,
      modelProvider: resolvedProviderId(baseURL, usingByok),
      gptZeroApiKey,
      workerId: `interactive-${auth.claims.sub}`,
    })
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof ExecutionConfigMismatchError) {
      return NextResponse.json({ error: { code: 'CONFIG_MISMATCH', message: err.message } }, { status: 409 })
    }
    const message = err instanceof Error ? err.message : 'Execution failed.'
    const notFound = message === 'Benchmark run not found.'
    return NextResponse.json({ error: { code: notFound ? 'NOT_FOUND' : 'EXECUTION_FAILED', message } }, { status: notFound ? 404 : 502 })
  }
}

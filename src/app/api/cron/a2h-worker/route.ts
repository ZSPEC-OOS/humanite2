import { NextRequest, NextResponse } from 'next/server'
import OpenAI from 'openai'
import { db } from '@/lib/firestore'
import { resolveProvider } from '@/lib/providerResolution'
import { listRunningRuns } from '@/lib/a2h/runs'
import { executeRunBatch } from '@/lib/a2h/execution'

// Phase 5's "server-side durable execution" worker — a Vercel Cron job
// invokes this route on a schedule (see vercel.json's `crons` entry),
// replacing the browser tab as what actually drives a run forward. It uses
// the EXACT SAME executeRunBatch/claimJob machinery the interactive
// "Run All" button does (see execution.ts), so the two can run concurrently
// without ever double-claiming (and double-paying for) the same job — this
// is not a second execution engine, just a second caller of the one that
// already exists.
//
// Credentials are always PLATFORM defaults (resolveProvider(null) ->
// process.env.OPENAI_API_KEY/OPENAI_MODEL, plus process.env.GPTZERO_API_KEY)
// — never a specific admin's BYOK, since a cron tick has no admin session to
// resolve one from. This matches how tests/benchmark's own live acceptance
// suite already resolves credentials (resolveProvider(null)) for exactly
// the same reason: benchmark execution is an operational task, not a
// per-user feature.
export const maxDuration = 300
// Leaves headroom under maxDuration for the in-flight run's own batch call
// to finish cleanly rather than being killed mid-request.
const TIME_BUDGET_MS = 270_000

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  // No CRON_SECRET configured means this route is not yet wired for
  // production use — refuse rather than silently running unauthenticated
  // paid work for anyone who finds the URL.
  if (!secret) return false
  return req.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Missing or invalid cron authorization.' } }, { status: 401 })
  }

  const { apiKey, baseURL, model } = resolveProvider(null)
  const gptZeroApiKey = process.env.GPTZERO_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: { code: 'NO_MODEL_CONFIGURED', message: 'OPENAI_API_KEY is not configured for this deployment.' } }, { status: 422 })
  }
  if (!gptZeroApiKey) {
    return NextResponse.json({ error: { code: 'NO_DETECTOR_CONFIGURED', message: 'GPTZERO_API_KEY is not configured for this deployment.' } }, { status: 422 })
  }
  const client = new OpenAI({ apiKey, baseURL })
  const workerId = `cron-${Date.now()}`

  const firestore = db()
  const runs = await listRunningRuns(firestore)
  const deadline = Date.now() + TIME_BUDGET_MS

  const results: Array<{ runId: string; processed: number; stage: string }> = []
  for (const run of runs) {
    if (Date.now() >= deadline) break
    try {
      const result = await executeRunBatch(firestore, run.id, {
        client, model, modelProvider: 'openai', gptZeroApiKey, workerId,
      })
      results.push({ runId: run.id, processed: result.processed, stage: result.stage })
    } catch (err) {
      results.push({ runId: run.id, processed: 0, stage: err instanceof Error ? `error: ${err.message}` : 'error' })
    }
  }

  return NextResponse.json({ workerId, runsConsidered: runs.length, results })
}

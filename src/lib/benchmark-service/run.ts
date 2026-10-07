/**
 * Executes one benchmark operation in-process against the product code.
 * No Next imports; the OpenAI client is injected so tests can mock it.
 *
 * Provenance: the three paths below call the same product functions the
 * product itself uses (runHumaniteDocument from src/lib/runHumaniteDocument,
 * repairGrammar / repairChunk from src/lib/evaluation/repair). Nothing is
 * copied; those modules live outside any benchmark-specific directory.
 */
import type OpenAI from 'openai'
import { runHumaniteDocument } from '@/lib/runHumaniteDocument'
import { repairGrammar, repairChunk } from '@/lib/evaluation/repair'
import { toValidDomain } from '@/lib/style/types'
import type { BenchmarkRequest } from './validate'

export interface BenchmarkResponse {
  output: string
  requestedIntensity: number | null
  appliedIntensity: number | null
  intensityCapped: boolean | null
  candidateCount: number | null
  modelUsed: string
  modelCalls: number | null
  inputTokens: number | null
  outputTokens: number | null
  retryCount: number
  latencyMs: number
  candidateSelection?: unknown
  gatesUnavailable?: boolean
  gatePassed?: boolean | null
}

export class UpstreamEmptyOutputError extends Error {
  constructor() {
    super('Model returned no output.')
    this.name = 'UpstreamEmptyOutputError'
  }
}

// Same default tone the product's repair evaluation used for fact repair.
const FACT_REPAIR_DEFAULT_TONE = 'balanced'

export async function runBenchmarkOperation(
  req: BenchmarkRequest,
  deps: { client: OpenAI; model: string },
): Promise<BenchmarkResponse> {
  const { client, model } = deps
  const start = Date.now()

  if (req.operation === 'humanize') {
    const r = await runHumaniteDocument({
      client, model,
      sourceText: req.text,
      requestedIntensity: req.settings.intensity,
      tone: req.settings.tone,
      domain: toValidDomain(req.settings.domain),
      genre: req.settings.genre,
      audience: req.settings.audience,
      candidateCountOverride: req.candidateCountOverride,
    })
    return {
      output: r.text,
      requestedIntensity: r.requestedIntensity,
      appliedIntensity: r.appliedIntensity,
      intensityCapped: r.intensityCapped,
      candidateCount: r.candidateCount,
      modelUsed: r.modelUsed,
      modelCalls: r.modelCalls,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      retryCount: r.retryCount,
      latencyMs: Date.now() - start,
      candidateSelection: r.chunkResult.candidateSelection,
      gatesUnavailable: r.chunkResult.gatesUnavailable,
      gatePassed: r.chunkResult.gate ? r.chunkResult.gate.passed : null,
    }
  }

  if (req.operation === 'repair_grammar') {
    const r = await repairGrammar(client, model, req.text)
    if (r.text === null) throw new UpstreamEmptyOutputError()
    return {
      output: r.text,
      requestedIntensity: null, appliedIntensity: null, intensityCapped: null, candidateCount: null,
      modelUsed: model,
      modelCalls: 1,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      retryCount: 0,
      latencyMs: Date.now() - start,
    }
  }

  // repair_facts: extra.sourceText is the clean ground truth, text is the
  // corrupted text to verify against it and repair.
  const r = await repairChunk(
    client, model,
    req.extra.sourceText as string,
    req.text,
    req.extra.tone ?? FACT_REPAIR_DEFAULT_TONE,
    req.extra.domain ?? req.settings.domain,
  )
  return {
    output: r.text,
    requestedIntensity: null, appliedIntensity: null, intensityCapped: null, candidateCount: null,
    modelUsed: model,
    modelCalls: r.modelCalls,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    retryCount: 0,
    latencyMs: Date.now() - start,
    // Fact ledger passed up front (nothing to repair) or the repair succeeded.
    gatePassed: !r.attempted || r.succeeded,
  }
}

export interface MappedError { status: number; code: string; message: string }

/** Maps a thrown error to a safe HTTP error. Never echoes err.message. */
export function mapBenchmarkError(err: unknown): MappedError {
  const status = typeof (err as { status?: unknown })?.status === 'number' ? (err as { status: number }).status : null
  const name = err instanceof Error ? err.constructor.name : typeof err
  if (status === 429) return { status: 429, code: 'RATE_LIMITED', message: 'Upstream model provider rate limited the request.' }
  if (err instanceof UpstreamEmptyOutputError || status !== null || /^(APIError|APIConnectionError|APIConnectionTimeoutError|APIUserAbortError)$/.test(name) || (err instanceof Error && /^(Connection|Timeout)/.test(name))) {
    return { status: 502, code: 'UPSTREAM_FAILED', message: 'Upstream model call failed.' }
  }
  return { status: 500, code: 'INTERNAL_ERROR', message: 'Internal error.' }
}

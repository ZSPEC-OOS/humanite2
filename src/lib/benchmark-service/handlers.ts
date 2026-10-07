/**
 * Framework-light handlers (Web Request/Response only, no Next imports) for
 * the benchmark service. The Next route files are one-line wrappers.
 *
 * SECURITY NOTE: these handlers deliberately bypass user auth, quota,
 * billing and usage metering. They are gated solely by the bearer token in
 * HUMANITE_BENCHMARK_TOKEN (see auth.ts) and return 404 when it is unset or
 * too short. This is intentionally application-agnostic.
 */
import OpenAI from 'openai'
import { resolveProvider } from '@/lib/providerResolution'
import { authorizeBenchmarkRequest } from './auth'
import { validateBenchmarkRequest, OPERATIONS, MAX_BODY_BYTES } from './validate'
import { runBenchmarkOperation, mapBenchmarkError } from './run'

const err = (status: number, code: string, message: string) =>
  Response.json({ error: { code, message } }, { status, headers: { 'Cache-Control': 'no-store' } })

export interface HandlerDeps {
  createClient?: () => { client: OpenAI; model: string } | null
}

function defaultCreateClient(): { client: OpenAI; model: string } | null {
  const { apiKey, baseURL, model } = resolveProvider(null)
  if (!apiKey) return null
  return { client: new OpenAI({ apiKey, baseURL }), model }
}

export async function handleBenchmarkHealth(req: Request): Promise<Response> {
  const auth = authorizeBenchmarkRequest(req.headers.get('authorization'), process.env.HUMANITE_BENCHMARK_TOKEN)
  if (!auth.ok) return err(auth.status, auth.code, auth.message)
  return Response.json({ ok: true, operations: [...OPERATIONS] }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function handleBenchmarkRun(req: Request, deps: HandlerDeps = {}): Promise<Response> {
  const auth = authorizeBenchmarkRequest(req.headers.get('authorization'), process.env.HUMANITE_BENCHMARK_TOKEN)
  if (!auth.ok) return err(auth.status, auth.code, auth.message)

  let raw: string
  try {
    raw = await req.text()
  } catch {
    return err(400, 'INVALID_JSON', 'Request body could not be read.')
  }
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
    return err(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large.')
  }
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return err(400, 'INVALID_JSON', 'Request body must be valid JSON.')
  }

  const parsed = validateBenchmarkRequest(body)
  if (!parsed.ok) return err(400, 'VALIDATION_ERROR', parsed.message)

  const provider = (deps.createClient ?? defaultCreateClient)()
  if (!provider) return err(500, 'NOT_CONFIGURED', 'Model provider is not configured.')

  try {
    const result = await runBenchmarkOperation(parsed.value, provider)
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    const mapped = mapBenchmarkError(e)
    // Log the error class only: never the message, which may carry input text.
    console.error('Benchmark operation failed', { operation: parsed.value.operation, type: e instanceof Error ? e.constructor.name : typeof e, status: mapped.status })
    return err(mapped.status, mapped.code, mapped.message)
  }
}

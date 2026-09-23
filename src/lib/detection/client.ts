import { ClassifyResult, DetectorError } from './contracts'

// Independent ML inference service (services/scanner) — a RoBERTa classifier
// plus engineered statistical/lexical features, not a general-purpose LLM.
// It never receives the humanizer's API key, model, or provider: detection
// must not depend on — or be gradeable by — whatever produced the text.
const SCANNER_SERVICE_URL = process.env.SCANNER_SERVICE_URL || 'http://localhost:8003'
const DETECT_TIMEOUT_MS = 20_000

interface ScannerServiceResponse {
  classification: ClassifyResult['classification']
  confidence: number
  human_probability: number
  ai_probability: number
  uncertain_probability: number
  per_sentence_perplexity?: number[]
  top_features?: ClassifyResult['top_features']
  explanation?: ClassifyResult['explanation']
  model_used: string
  processing_duration_ms?: number
}

export async function classify(
  text: string,
  mode: 'quick' | 'standard' = 'standard',
  domainHint = 'general',
): Promise<ClassifyResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), DETECT_TIMEOUT_MS)

  let resp: Response
  try {
    resp = await fetch(`${SCANNER_SERVICE_URL}/scan/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, mode, domain_hint: domainHint }),
      signal: controller.signal,
    })
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new DetectorError('DETECTOR_TIMEOUT', 'Scanner service timed out.')
    }
    throw new DetectorError('DETECTOR_UNAVAILABLE', 'Scanner service is unreachable.')
  } finally {
    clearTimeout(timeout)
  }

  if (!resp.ok) {
    let detail: { code?: string; message?: string } = {}
    try {
      const body = await resp.json()
      detail = body?.detail ?? body?.error ?? {}
    } catch {
      // ignore parse failure — fall through to the generic message below
    }
    if (resp.status === 400) {
      throw new DetectorError('INVALID_INPUT', detail.message ?? 'Scanner rejected the input.')
    }
    throw new DetectorError('INFERENCE_ERROR', detail.message ?? `Scanner returned HTTP ${resp.status}.`)
  }

  const data = (await resp.json()) as ScannerServiceResponse

  return {
    classification: data.classification,
    confidence: data.confidence,
    human_probability: data.human_probability,
    ai_probability: data.ai_probability,
    uncertain_probability: data.uncertain_probability,
    per_sentence_perplexity: data.per_sentence_perplexity ?? [],
    top_features: data.top_features ?? [],
    explanation: data.explanation ?? { summary: '', detail: '' },
    model_used: data.model_used,
    processing_duration_ms: data.processing_duration_ms ?? null,
  }
}

// The detector service role: a GPTZero-compatible API (POST {origin}/v2/predict/text, X-API-Key, { document }).
//
// The package declares a role named 'detector' and the operator binds a stored credential of type 'api_key' to it.
// Its payload holds the key as `token` (or `apiKey`) and, optionally, `baseUrl`: the origin of a GPTZero-compatible
// service (default https://api.gptzero.me; http only for localhost). Response mapping is the one Humanite used
// (src/lib/detection/normalize.ts @ 141e366): a class (HUMAN_ONLY | MIXED | AI_ONLY, or human | mixed | ai), the
// class probabilities, or, in the minimal shape, the AI probability with its complement as the human one.
//
// Nothing here logs; errors carry a status code only, never the text, the key or the service's message.
import { FrameworkError, parseServiceRoleId, type JsonObject } from '@benchmarkr/core'
import type { BenchmarkMemo, ServiceAccess } from '@benchmarkr/contracts'
import { createHash } from 'crypto'
import type { DetectionClassification } from '../vendor/detection/contracts'
import type { DetectorScore } from '../scoring/trialCommon'
import { failureFor, parseOrigin, postJson, sleepAbortable, TransportError, type SignalLike, linkedAbort } from './http'
import { configError, finite, isRecord, str } from './util'

export const DETECTOR_ROLE = parseServiceRoleId('detector')
export const DETECTOR_CREDENTIAL_TYPE = 'api_key'
export const DEFAULT_DETECTOR_ORIGIN = 'https://api.gptzero.me'
export const DEFAULT_DETECTOR_CONFIG_ID = 'gptzero-default'
const PREDICT_PATH = '/v2/predict/text'

export interface DetectorConfig {
  readonly origin: string
  readonly apiKey: string
  /** Identifies the detector configuration in memo keys: the default is Humanite's id, anything else a host digest. */
  readonly configId: string
}

/** What the detector said about one text, before it is tied to a run. */
export type RawDetectorScore = Omit<DetectorScore, 'runId'>

const CLASS_MAP: Record<string, DetectionClassification> = {
  HUMAN_ONLY: 'human-written',
  MIXED: 'mixed',
  AI_ONLY: 'ai-generated',
  human: 'human-written',
  ai: 'ai-generated',
  mixed: 'mixed',
}

const round4 = (n: number): number => Math.round(n * 10000) / 10000

/** The detector's own answer in the ark's vocabulary (a port of normalizeGPTZero's score fields). */
export function normalizeDetectorResponse(raw: unknown, analyzedAt: string): RawDetectorScore {
  if (!isRecord(raw)) throw new FrameworkError('VERIFIER_ERROR', 'The detector returned a non-object response')
  const documents = raw['documents']
  const first: unknown = Array.isArray(documents) ? documents[0] : undefined
  const doc = isRecord(first) ? first : raw
  const rawClass = str(doc['document_classification']) ?? str(doc['classification'])
  const classification: DetectionClassification = rawClass === undefined ? 'uncertain' : (CLASS_MAP[rawClass] ?? 'uncertain')
  const probs = doc['class_probabilities']
  let ai: number | null
  let human: number | null
  let mixed: number | null
  if (isRecord(probs)) {
    human = finite(probs['human']) ?? null
    ai = finite(probs['ai']) ?? null
    mixed = finite(probs['mixed']) ?? null
  } else {
    const p = finite(doc['completely_generated_prob']) ?? finite(doc['average_generated_prob'])
    ai = p === undefined ? null : round4(p)
    human = p === undefined ? null : round4(1 - p)
    mixed = null
  }
  return { aiProbability: ai, humanProbability: human, mixedProbability: mixed, classification, analyzedAt }
}

/** The detector bound to this run, with its key resolved at this moment. */
export async function resolveDetector(services: ServiceAccess | undefined): Promise<DetectorConfig> {
  if (services === undefined || !services.has(DETECTOR_ROLE)) {
    throw configError('This test needs the detector service role to be bound')
  }
  const resolved = await services.resolve(DETECTOR_ROLE)
  let payload: unknown
  try {
    payload = JSON.parse(resolved.secret)
  } catch {
    payload = resolved.secret
  }
  const apiKey = typeof payload === 'string' ? payload : (str(isRecord(payload) ? payload['token'] : undefined) ?? str(isRecord(payload) ? payload['apiKey'] : undefined))
  if (apiKey === undefined || apiKey === '') throw configError('The detector credential holds no key')
  const baseUrl = isRecord(payload) ? payload['baseUrl'] : undefined
  const origin = baseUrl === undefined ? DEFAULT_DETECTOR_ORIGIN : parseOrigin(baseUrl, 'The detector baseUrl')
  const configId =
    origin === DEFAULT_DETECTOR_ORIGIN
      ? DEFAULT_DETECTOR_CONFIG_ID
      : `compat-${createHash('sha256').update(origin).digest('hex').slice(0, 12)}`
  return { origin, apiKey, configId }
}

export interface ScoreOptions {
  readonly timeoutMs?: number
  readonly attempts?: number
  readonly baseDelayMs?: number
  readonly maxDelayMs?: number
}

/**
 * Scores one text. Rate limits, timeouts and 5xx are retried a few times with a bounded back-off (a detector outage
 * must not turn every trial into a failure); anything else fails at once.
 */
export async function detectText(text: string, config: DetectorConfig, signal: SignalLike | undefined, options: ScoreOptions = {}): Promise<RawDetectorScore> {
  const attempts = options.attempts ?? 4
  const { controller, dispose } = linkedAbort(signal)
  try {
    for (let attempt = 1; ; attempt += 1) {
      let status: number | 'timeout' | 'network' | 'aborted' | 'too_large' | 'bad_json'
      let retryAfterMs: number | undefined
      let body: unknown
      try {
        const outcome = await postJson({
          url: `${config.origin}${PREDICT_PATH}`,
          headers: { 'x-api-key': config.apiKey },
          body: { document: text },
          timeoutMs: options.timeoutMs ?? 60_000,
          signal: controller.signal,
          maxResponseBytes: 8 * 1024 * 1024,
        })
        status = outcome.status
        retryAfterMs = outcome.retryAfterMs
        body = outcome.body
        if (status >= 200 && status < 300) return normalizeDetectorResponse(body, new Date().toISOString())
      } catch (error) {
        if (!(error instanceof TransportError)) throw error
        status = error.kind
      }
      const retryable = status === 'timeout' || status === 'network' || (typeof status === 'number' && (status === 408 || status === 429 || status >= 500))
      if (!retryable || attempt >= attempts || controller.signal.aborted) throw failureFor('The detector', status, body, 'VERIFIER_ERROR')
      const wait = Math.min(retryAfterMs ?? (options.baseDelayMs ?? 500) * 2 ** (attempt - 1), options.maxDelayMs ?? 20_000)
      await sleepAbortable(wait, controller.signal)
    }
  } finally {
    dispose()
  }
}

const BASELINE_NAMESPACE = 'a2h.detector-baseline'
const isClassification = (v: unknown): v is DetectionClassification =>
  v === 'human-written' || v === 'ai-generated' || v === 'mixed' || v === 'uncertain'

function scoreFromMemo(value: JsonObject, runId: string): DetectorScore {
  const classification = value['classification']
  if (!isClassification(classification)) throw new FrameworkError('VERIFIER_ERROR', 'A cached detector score is not usable')
  return {
    aiProbability: finite(value['aiProbability']) ?? null,
    humanProbability: finite(value['humanProbability']) ?? null,
    mixedProbability: finite(value['mixedProbability']) ?? null,
    classification,
    analyzedAt: str(value['analyzedAt']) ?? '',
    runId,
  }
}

/**
 * The detector's score of a frozen source text. It is computed once per (corpus item content hash, detector
 * configuration) and shared by every later trial and run in the workspace through the framework memo, as
 * Humanite shared a baseline by (sourceId, detectorConfigId). `runId` is the run that first computed it.
 */
export async function baselineScore(
  memo: BenchmarkMemo | undefined,
  itemHash: string,
  text: string,
  config: DetectorConfig,
  signal: SignalLike | undefined,
  currentRunId: string,
  options?: ScoreOptions,
): Promise<{ score: DetectorScore; cached: boolean }> {
  const compute = async (): Promise<JsonObject> => {
    const raw = await detectText(text, config, signal, options)
    return { ...raw }
  }
  if (memo === undefined) {
    const raw = await compute()
    return { score: scoreFromMemo(raw, currentRunId), cached: false }
  }
  const entry = await memo.getOrCompute(BASELINE_NAMESPACE, `${itemHash}:${config.configId}`, compute)
  return { score: scoreFromMemo(entry.value, entry.computedBy), cached: entry.cached }
}

import { DetectionOptions, DetectionProviderError, DetectionResult } from './contracts'
import { calculateLocalDiagnostics } from './diagnostics'
import { DetectionProvider } from './providers/provider'
import { GPTZeroProvider } from './providers/gptzero'
import { SaplingProvider } from './providers/sapling'
import { MockDetectionProvider, MockFixtureName } from './providers/mock'

// Below this word count, a detector's classification is generally less
// reliable — not a hard cutoff (still worth showing a result), but worth
// flagging so a one-sentence scan doesn't display with the same apparent
// confidence as a full-paragraph one.
const RELIABLE_MIN_WORDS = 50

// Every production detection request flows through this — it's the one
// place that adds timing, local diagnostics, and a short-text reliability
// warning on top of whatever the provider returns, so providers themselves
// stay simple and both call sites (manual /v1/scan and the automatic
// post-humanize scan) get this consistently rather than each needing its
// own copy of the threshold.
export class DetectionGateway {
  constructor(
    private readonly provider: DetectionProvider,
    private readonly diagnosticsEnabled: boolean = process.env.LOCAL_DIAGNOSTICS_ENABLED !== 'false',
  ) {}

  // Lets callers key a cache or telemetry record to the active backend
  // without re-deriving the DETECTION_PROVIDER selection logic themselves.
  get providerId(): string {
    return this.provider.id
  }

  async detect(text: string, options?: DetectionOptions): Promise<DetectionResult> {
    const started = performance.now()
    const result = await this.provider.detect(text, options)
    const diagnostics = this.diagnosticsEnabled ? calculateLocalDiagnostics(text) : null
    const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0
    const warnings = wordCount < RELIABLE_MIN_WORDS
      ? [...result.warnings, `This text is short (${wordCount} words) — detection accuracy is generally lower on short passages. Treat this result with extra caution.`]
      : result.warnings
    return {
      ...result,
      diagnostics,
      warnings,
      processing_duration_ms: Math.round(performance.now() - started),
    }
  }
}

const MOCK_FIXTURES = new Set<MockFixtureName>([
  'human', 'ai', 'mixed', 'low-confidence', 'timeout', 'rate-limit', 'invalid-response',
])

function isMockFixtureName(value: string): value is MockFixtureName {
  return MOCK_FIXTURES.has(value as MockFixtureName)
}

function buildProvider(apiKeyOverride?: string): DetectionProvider {
  // A caller-supplied key (the user's own GPTZero account, set via the AI
  // Model settings panel) always wins — same precedence as the humanizer's
  // own api_config.api_key overriding the server's OPENAI_API_KEY. Explicitly
  // providing a key is the user opting in to a live call regardless of how
  // this deployment's DETECTION_PROVIDER is set. The BYOK path is GPTZero-
  // specific for now — it predates Sapling support, and the settings panel
  // has no separate "bring your own Sapling key" field yet.
  if (apiKeyOverride) return new GPTZeroProvider(apiKeyOverride)

  if (process.env.DETECTION_PROVIDER === 'sapling') {
    return new SaplingProvider()
  }
  if (process.env.DETECTION_PROVIDER === 'gptzero') {
    return new GPTZeroProvider()
  }

  // A misconfigured production deployment must never silently serve
  // fabricated detection results — fail loudly instead of falling back to
  // mock. ALLOW_MOCK_DETECTION=true is the explicit opt-out, for a
  // staging/demo instance intentionally running in production mode without
  // a live key.
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_MOCK_DETECTION !== 'true') {
    throw new DetectionProviderError(
      'PROVIDER_UNAVAILABLE',
      'AI detection is not configured for production — DETECTION_PROVIDER must be "sapling" or "gptzero". ' +
        'Set ALLOW_MOCK_DETECTION=true to intentionally run the mock provider instead.',
    )
  }

  // Default: mock. Local dev and CI never spend a real GPTZero request.
  // Defaults to 'mixed' rather than 'human' — an unconfigured dev
  // environment must never make an unscanned or misconfigured detection
  // read as a clean "human" result by default.
  const fixture = process.env.MOCK_DETECTION_FIXTURE ?? 'mixed'
  return new MockDetectionProvider(isMockFixtureName(fixture) ? fixture : 'mixed')
}

let gateway: DetectionGateway | null = null

// Single entry point the API routes use for detection. Which backend
// actually runs is controlled entirely by DETECTION_PROVIDER — nothing
// downstream of this needs to know whether it's talking to GPTZero or the
// mock — unless the caller passes its own GPTZero key, in which case a
// fresh, non-memoized gateway is built for that one call: keys are
// per-user, so they must never leak into the shared singleton other
// requests reuse.
export function getDetectionGateway(apiKeyOverride?: string): DetectionGateway {
  if (apiKeyOverride) return new DetectionGateway(buildProvider(apiKeyOverride))
  if (!gateway) gateway = new DetectionGateway(buildProvider())
  return gateway
}

// Test-only: forces the next getDetectionGateway() call to rebuild from
// current env vars instead of returning the memoized singleton.
export function resetDetectionGatewayForTests(): void {
  gateway = null
}

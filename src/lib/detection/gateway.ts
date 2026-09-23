import { DetectionOptions, DetectionResult } from './contracts'
import { calculateLocalDiagnostics } from './diagnostics'
import { DetectionProvider } from './providers/provider'
import { GPTZeroProvider } from './providers/gptzero'
import { MockDetectionProvider, MockFixtureName } from './providers/mock'

// Every production detection request flows through this — it's the one
// place that adds timing and local diagnostics on top of whatever the
// provider returns, so providers themselves stay simple.
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
    return {
      ...result,
      diagnostics,
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
  // this deployment's DETECTION_PROVIDER is set.
  if (apiKeyOverride) return new GPTZeroProvider(apiKeyOverride)

  if (process.env.DETECTION_PROVIDER === 'gptzero') {
    return new GPTZeroProvider()
  }
  // Default: mock. Production deployments must set DETECTION_PROVIDER=gptzero
  // explicitly — an unset var failing toward obviously-fake results is safer
  // than silently defaulting to a live, billable API call.
  const fixture = process.env.MOCK_DETECTION_FIXTURE ?? 'human'
  return new MockDetectionProvider(isMockFixtureName(fixture) ? fixture : 'human')
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

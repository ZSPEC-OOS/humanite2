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

function buildProvider(): DetectionProvider {
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
// mock.
export function getDetectionGateway(): DetectionGateway {
  if (!gateway) gateway = new DetectionGateway(buildProvider())
  return gateway
}

// Test-only: forces the next getDetectionGateway() call to rebuild from
// current env vars instead of returning the memoized singleton.
export function resetDetectionGatewayForTests(): void {
  gateway = null
}

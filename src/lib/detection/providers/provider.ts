import { DetectionOptions, DetectionResult } from '../contracts'

// Everything a detection provider itself supplies. processing_duration_ms
// is timed by DetectionGateway around every provider call, and diagnostics
// are computed locally rather than by any provider — both are attached
// after detect() returns, so no provider result carries them.
export type DetectionProviderResult = Omit<DetectionResult, 'processing_duration_ms' | 'diagnostics'>

// Implemented by every detection backend (GPTZeroProvider in production,
// MockDetectionProvider in development/tests). This boundary exists so the
// app can swap, mock, or version-migrate the provider without touching the
// gateway, API routes, or stores that consume DetectionResult — not to
// support building an in-house detector behind it.
export interface DetectionProvider {
  readonly id: string
  detect(text: string, options?: DetectionOptions): Promise<DetectionProviderResult>
}

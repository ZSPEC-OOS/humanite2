// Structured, greppable telemetry for detection requests (spec §50) — no
// raw document text, ever (spec §45). Emitted as one JSON line per event so
// any log aggregator (Vercel log drains, Datadog, Grafana Loki, ...) can
// turn these into request counts, GPTZero latency, 429/5xx frequency, and
// classification/confidence distributions without this process needing to
// track state itself — a serverless function has no persistent memory to
// aggregate into between invocations.

export type ScanTrigger = 'manual' | 'auto'

interface ScanRequestedEvent {
  event: 'scan_requested'
  trigger: ScanTrigger
  words: number
  chars: number
}

interface ScanCompletedEvent {
  event: 'scan_completed'
  trigger: ScanTrigger
  provider: string
  classification: string
  confidence_category: string
  cache_hit: boolean
  duration_ms: number
}

interface ScanFailedEvent {
  event: 'scan_failed'
  trigger: ScanTrigger
  error_code: string
  // Only set when the failure actually determined an HTTP response status
  // (the manual /v1/scan path) — the automatic post-humanize scan fails
  // silently from the caller's perspective (humanize still returns 200),
  // so there's no status to report there.
  http_status?: number
}

export type ScanTelemetryEvent = ScanRequestedEvent | ScanCompletedEvent | ScanFailedEvent

export function recordScanTelemetry(event: ScanTelemetryEvent): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...event }))
}

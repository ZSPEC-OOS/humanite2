import { describe, it, expect, vi, afterEach } from 'vitest'
import { recordScanTelemetry } from '../scanTelemetry'

describe('recordScanTelemetry', () => {
  afterEach(() => vi.restoreAllMocks())

  it('emits a single JSON line to console.log', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    recordScanTelemetry({ event: 'scan_requested', trigger: 'manual', words: 42, chars: 250 })

    expect(spy).toHaveBeenCalledTimes(1)
    const parsed = JSON.parse(spy.mock.calls[0]![0] as string)
    expect(parsed).toMatchObject({ event: 'scan_requested', trigger: 'manual', words: 42, chars: 250 })
    expect(typeof parsed.ts).toBe('string')
  })

  it('carries every field for a scan_completed event', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    recordScanTelemetry({
      event: 'scan_completed',
      trigger: 'auto',
      provider: 'gptzero',
      classification: 'ai-generated',
      confidence_category: 'high',
      cache_hit: false,
      duration_ms: 812,
    })

    const parsed = JSON.parse(spy.mock.calls[0]![0] as string)
    expect(parsed).toMatchObject({
      event: 'scan_completed',
      trigger: 'auto',
      provider: 'gptzero',
      classification: 'ai-generated',
      confidence_category: 'high',
      cache_hit: false,
      duration_ms: 812,
    })
  })

  it('omits http_status on the auto-scan failure path, where nothing is returned to a client', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    recordScanTelemetry({ event: 'scan_failed', trigger: 'auto', error_code: 'PROVIDER_TIMEOUT' })

    const parsed = JSON.parse(spy.mock.calls[0]![0] as string)
    expect(parsed.http_status).toBeUndefined()
  })

  it('includes http_status on the manual-scan failure path', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    recordScanTelemetry({ event: 'scan_failed', trigger: 'manual', error_code: 'PROVIDER_RATE_LIMITED', http_status: 429 })

    const parsed = JSON.parse(spy.mock.calls[0]![0] as string)
    expect(parsed.http_status).toBe(429)
  })

  // Privacy regression guard (spec §45): telemetry must never carry the
  // scanned document itself, however tempting a "text" or "content" field
  // would be for debugging. Every field on every event type is a scalar
  // (string/number/boolean) by construction — this asserts that holds for
  // whatever gets logged, not just the fixed set of fields above.
  it('never emits a field containing scanned document text', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    recordScanTelemetry({
      event: 'scan_completed',
      trigger: 'manual',
      provider: 'gptzero',
      classification: 'mixed',
      confidence_category: 'medium',
      cache_hit: true,
      duration_ms: 0,
    })

    const parsed = JSON.parse(spy.mock.calls[0]![0] as string)
    for (const [key, value] of Object.entries(parsed)) {
      expect(['string', 'number', 'boolean']).toContain(typeof value)
      if (typeof value === 'string') {
        // No field is long free-form prose — every string field here is a
        // short enum/id/timestamp, never document content.
        expect(value.length).toBeLessThan(64)
      }
      expect(key).not.toMatch(/text|content|document/i)
    }
  })
})

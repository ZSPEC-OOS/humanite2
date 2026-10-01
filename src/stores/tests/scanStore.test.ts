import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { ScanAPIResponse } from '@/lib/api'

const { apiScanMock } = vi.hoisted(() => ({ apiScanMock: vi.fn() }))

vi.mock('@/lib/api', () => ({ apiScan: apiScanMock }))

const { useScanStore } = await import('../scanStore')

function scanResult(overrides: Partial<ScanAPIResponse> = {}): ScanAPIResponse {
  return {
    job_id: 'scan-1', status: 'completed', scan_id: null, result_url: null,
    classification: 'human', ai_probability: 0.1, human_probability: 0.9,
    ...overrides,
  } as unknown as ScanAPIResponse
}

// Stale-write-guard regression test, mirroring humanizeStore.test.ts: a
// reset() (or a fresher applyResult(), e.g. from the auto-scan-after-
// humanize path) while a manual scan() is still in flight must not let that
// scan's late result overwrite the newer state.
describe('useScanStore — stale-write guard (activeGeneration)', () => {
  beforeEach(() => {
    apiScanMock.mockReset()
    useScanStore.setState({ response: null, status: 'idle', error: null })
  })

  it('reset() while scan() is in flight prevents its later result from landing', async () => {
    let resolveScan!: (resp: ScanAPIResponse) => void
    apiScanMock.mockImplementation(() => new Promise<ScanAPIResponse>(resolve => { resolveScan = resolve }))

    const promise = useScanStore.getState().scan('some text')
    useScanStore.getState().reset()
    expect(useScanStore.getState().status).toBe('idle')

    resolveScan(scanResult())
    await promise

    expect(useScanStore.getState().status).toBe('idle')
    expect(useScanStore.getState().response).toBeNull()
  })

  it('applyResult() (the auto-scan-after-humanize path) supersedes an in-flight manual scan', async () => {
    let resolveScan!: (resp: ScanAPIResponse) => void
    apiScanMock.mockImplementation(() => new Promise<ScanAPIResponse>(resolve => { resolveScan = resolve }))

    const promise = useScanStore.getState().scan('some text')
    useScanStore.getState().applyResult(scanResult({ job_id: 'auto-scan-1' }))
    expect(useScanStore.getState().response?.job_id).toBe('auto-scan-1')

    resolveScan(scanResult({ job_id: 'manual-scan-1' }))
    await promise

    expect(useScanStore.getState().response?.job_id).toBe('auto-scan-1')
  })

  it('normal completion (no reset) still applies the result', async () => {
    apiScanMock.mockResolvedValue(scanResult())
    await useScanStore.getState().scan('some text')
    expect(useScanStore.getState().status).toBe('done')
    expect(useScanStore.getState().response?.job_id).toBe('scan-1')
  })
})

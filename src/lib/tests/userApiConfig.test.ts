import { describe, it, expect, vi } from 'vitest'

const { getApiConfigMock } = vi.hoisted(() => ({ getApiConfigMock: vi.fn() }))

vi.mock('@/lib/r2', () => ({
  getApiConfig: getApiConfigMock,
}))

const { getUserApiConfig } = await import('../userApiConfig')

describe('getUserApiConfig', () => {
  it('returns the stored config on success', async () => {
    const stored = { nickname: 'n', modelId: 'm', baseUrl: '', apiKey: 'sk-1', gptzeroApiKey: '' }
    getApiConfigMock.mockResolvedValueOnce(stored)
    expect(await getUserApiConfig('user-1')).toEqual(stored)
  })

  it('returns null when nothing is stored (NoSuchKey, per getApiConfig)', async () => {
    getApiConfigMock.mockResolvedValueOnce(null)
    expect(await getUserApiConfig('user-1')).toBeNull()
  })

  it('returns null (does not throw) when R2 is entirely unconfigured', async () => {
    // getApiConfig's own client() throws synchronously for this case — not
    // caught by getApiConfig itself (only NoSuchKey/NotFound are), so this
    // wrapper is the actual safety net every humanize/scan request relies on.
    getApiConfigMock.mockImplementationOnce(() => {
      throw new Error('Missing R2 credentials: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY')
    })
    await expect(getUserApiConfig('user-1')).resolves.toBeNull()
  })

  it('returns null when R2 rejects for any other reason (network, permissions, etc.)', async () => {
    getApiConfigMock.mockRejectedValueOnce(new Error('ECONNREFUSED'))
    await expect(getUserApiConfig('user-1')).resolves.toBeNull()
  })
})

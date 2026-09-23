import { describe, it, expect } from 'vitest'
import { isAllowedProviderBaseUrl } from '../providerAllowlist'

describe('isAllowedProviderBaseUrl', () => {
  it('allows a known provider over https', () => {
    expect(isAllowedProviderBaseUrl('https://api.openai.com/v1')).toBe(true)
    expect(isAllowedProviderBaseUrl('https://api.deepseek.com/v1')).toBe(true)
    expect(isAllowedProviderBaseUrl('https://openrouter.ai/api/v1')).toBe(true)
  })

  it('rejects a known provider host over plain http', () => {
    expect(isAllowedProviderBaseUrl('http://api.openai.com/v1')).toBe(false)
  })

  it('rejects a host not on the allowlist', () => {
    expect(isAllowedProviderBaseUrl('https://evil.example.com/v1')).toBe(false)
  })

  it('rejects loopback and private-network addresses', () => {
    expect(isAllowedProviderBaseUrl('https://localhost/v1')).toBe(false)
    expect(isAllowedProviderBaseUrl('https://127.0.0.1/v1')).toBe(false)
    expect(isAllowedProviderBaseUrl('https://10.0.0.5/v1')).toBe(false)
    expect(isAllowedProviderBaseUrl('https://192.168.1.1/v1')).toBe(false)
  })

  it('rejects a cloud metadata address', () => {
    expect(isAllowedProviderBaseUrl('https://169.254.169.254/latest/meta-data/')).toBe(false)
  })

  it('rejects a lookalike host that merely contains an allowed name', () => {
    expect(isAllowedProviderBaseUrl('https://api.openai.com.evil.example.com/v1')).toBe(false)
    expect(isAllowedProviderBaseUrl('https://evil-api.openai.com.example.com/v1')).toBe(false)
  })

  it('is case-insensitive on the hostname', () => {
    expect(isAllowedProviderBaseUrl('https://API.OPENAI.COM/v1')).toBe(true)
  })

  it('rejects a malformed URL rather than throwing', () => {
    expect(isAllowedProviderBaseUrl('not-a-url')).toBe(false)
    expect(isAllowedProviderBaseUrl('')).toBe(false)
  })

  it('rejects an allowed host used only as basic auth userinfo, not the actual host', () => {
    // A classic SSRF-via-URL-parsing trick: the browser/naive-regex reads
    // "api.openai.com" but the real connection target is evil.example.com.
    expect(isAllowedProviderBaseUrl('https://api.openai.com@evil.example.com/v1')).toBe(false)
  })
})

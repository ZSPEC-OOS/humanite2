import { describe, it, expect } from 'vitest'
import { safeNextPath } from '../safeRedirect'

describe('safeNextPath', () => {
  it('passes through an ordinary internal path', () => {
    expect(safeNextPath('/developer')).toBe('/developer')
    expect(safeNextPath('/account')).toBe('/account')
    expect(safeNextPath('/dashboard?tab=history')).toBe('/dashboard?tab=history')
  })

  it('falls back to /dashboard when next is missing', () => {
    expect(safeNextPath(null)).toBe('/dashboard')
    expect(safeNextPath(undefined)).toBe('/dashboard')
    expect(safeNextPath('')).toBe('/dashboard')
  })

  it('honors a custom fallback', () => {
    expect(safeNextPath(null, '/developer')).toBe('/developer')
  })

  it('rejects an absolute external URL', () => {
    expect(safeNextPath('https://malicious-site.com')).toBe('/dashboard')
    expect(safeNextPath('http://malicious-site.com/phish')).toBe('/dashboard')
  })

  it('rejects a protocol-relative URL', () => {
    expect(safeNextPath('//malicious-site.com')).toBe('/dashboard')
  })

  it('rejects a backslash-prefixed path (browser-normalized protocol-relative trick)', () => {
    expect(safeNextPath('/\\malicious-site.com')).toBe('/dashboard')
  })

  it('rejects a path missing its leading slash', () => {
    expect(safeNextPath('developer')).toBe('/dashboard')
    expect(safeNextPath('malicious-site.com')).toBe('/dashboard')
  })

  it('rejects a javascript: scheme smuggled behind a slash', () => {
    expect(safeNextPath('/javascript:alert(1)')).toBe('/dashboard')
  })
})

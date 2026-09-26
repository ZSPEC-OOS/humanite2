import { describe, it, expect } from 'vitest'
import { effectiveIntensity } from '../effectiveIntensity'
import { DOMAIN_INTENSITY_CAPS } from '../types'
import { DOMAINS } from '@/lib/style/types'

describe('effectiveIntensity', () => {
  it('caps legal at 4, medical at 5, technical at 7, academic at 8, and leaves business/general uncapped at 10', () => {
    expect(DOMAIN_INTENSITY_CAPS.legal).toBe(4)
    expect(DOMAIN_INTENSITY_CAPS.medical).toBe(5)
    expect(DOMAIN_INTENSITY_CAPS.technical).toBe(7)
    expect(DOMAIN_INTENSITY_CAPS.academic).toBe(8)
    expect(DOMAIN_INTENSITY_CAPS.business).toBe(10)
    expect(DOMAIN_INTENSITY_CAPS.general).toBe(10)
  })

  it('defines a cap for every domain the product exposes', () => {
    for (const domain of DOMAINS) {
      expect(DOMAIN_INTENSITY_CAPS[domain]).toBeGreaterThan(0)
    }
  })

  it('applies the requested value unchanged when it is at or below the domain cap', () => {
    const result = effectiveIntensity(3, 'legal')
    expect(result).toEqual({ requested: 3, applied: 3, domain: 'legal', capped: false })
  })

  it('caps the applied value at the domain ceiling and flags capped:true when the request exceeds it', () => {
    const result = effectiveIntensity(8, 'medical')
    expect(result).toEqual({ requested: 8, applied: 5, domain: 'medical', capped: true })
  })

  it('never caps a domain with no special restriction (general/business) up to 10', () => {
    expect(effectiveIntensity(10, 'general')).toEqual({ requested: 10, applied: 10, domain: 'general', capped: false })
    expect(effectiveIntensity(10, 'business')).toEqual({ requested: 10, applied: 10, domain: 'business', capped: false })
  })

  it('is never capped exactly at the domain ceiling itself', () => {
    expect(effectiveIntensity(4, 'legal').capped).toBe(false)
  })
})

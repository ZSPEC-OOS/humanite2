import { describe, it, expect } from 'vitest'
import { PRICING_TIERS } from '../pricing'

describe('PRICING_TIERS', () => {
  it('contains exactly free, starter, pro, enterprise, in that order', () => {
    expect(PRICING_TIERS.map(t => t.id)).toEqual(['free', 'starter', 'pro', 'enterprise'])
  })

  it('maps internal ids to the correct public names', () => {
    const byId = Object.fromEntries(PRICING_TIERS.map(t => [t.id, t.name]))
    expect(byId['free']).toBe('Free')
    expect(byId['starter']).toBe('Starter')
    expect(byId['pro']).toBe('Pro')
    // 'enterprise' is the internal id kept for backward compatibility — it
    // must never be shown to users as its own name.
    expect(byId['enterprise']).toBe('Max')
  })

  it('Free has no Stripe price and no checkout — only a static registration link', () => {
    const free = PRICING_TIERS.find(t => t.id === 'free')!
    expect(free.stripePriceEnvVar).toBeUndefined()
    expect(free.price).toBe('$0')
    expect(free.ctaHref).toBeTruthy()
  })

  it('Starter/Pro/Max each have a distinct Stripe Price ID env var, and none of them is Free\'s', () => {
    const starter = PRICING_TIERS.find(t => t.id === 'starter')!
    const pro = PRICING_TIERS.find(t => t.id === 'pro')!
    const max = PRICING_TIERS.find(t => t.id === 'enterprise')!
    expect(starter.stripePriceEnvVar).toBe('STRIPE_PRICE_ID_STARTER')
    expect(pro.stripePriceEnvVar).toBe('STRIPE_PRICE_ID_PRO')
    expect(max.stripePriceEnvVar).toBe('STRIPE_PRICE_ID_MAX')
  })

  it('advertises the canonical monthly word allowances for each tier', () => {
    const allowances: Record<string, string> = {
      free: '5,000',
      starter: '50,000',
      pro: '100,000',
      enterprise: '150,000',
    }
    for (const tier of PRICING_TIERS) {
      const expected = allowances[tier.id]!
      expect(tier.features.some(f => f.includes(`${expected} generated words`))).toBe(true)
      expect(tier.features.some(f => f.includes(`${expected} scanned words`))).toBe(true)
    }
  })

  it('prices strictly increase from Free through Max', () => {
    const prices = PRICING_TIERS.map(t => Number(t.price.replace('$', '')))
    expect(prices).toEqual([0, 5, 10, 15])
  })
})

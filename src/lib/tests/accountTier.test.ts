import { describe, it, expect } from 'vitest'
import { GOLD_TIER, ACCOUNT_TIERS, isGoldTier, resolveEffectiveTier } from '../accountTier'
import { PRICING_TIERS } from '../pricing'

describe('accountTier', () => {
  it('GOLD_TIER is a distinct value from every purchasable pricing tier', () => {
    expect(PRICING_TIERS.map(t => t.id)).not.toContain(GOLD_TIER)
  })

  it('ACCOUNT_TIERS includes every purchasable pricing tier plus gold', () => {
    for (const t of PRICING_TIERS) {
      expect(ACCOUNT_TIERS).toContain(t.id)
    }
    expect(ACCOUNT_TIERS).toContain(GOLD_TIER)
  })

  describe('isGoldTier', () => {
    it('is true only for the gold tier', () => {
      expect(isGoldTier('gold')).toBe(true)
      expect(isGoldTier(GOLD_TIER)).toBe(true)
    })

    it('is false for every purchasable tier, null, undefined, and an unrecognized string', () => {
      expect(isGoldTier('free')).toBe(false)
      expect(isGoldTier('pro')).toBe(false)
      expect(isGoldTier('enterprise')).toBe(false)
      expect(isGoldTier(null)).toBe(false)
      expect(isGoldTier(undefined)).toBe(false)
      expect(isGoldTier('not-a-real-tier')).toBe(false)
      // Case-sensitive on purpose — the stored tier field is always
      // lowercase (see userRegistration.ts), so a near-miss like 'Gold'
      // must not silently match.
      expect(isGoldTier('Gold')).toBe(false)
      expect(isGoldTier('GOLD')).toBe(false)
    })
  })

  describe('resolveEffectiveTier', () => {
    it('overrides a hardcoded Gold account to gold regardless of its stored tier', () => {
      expect(resolveEffectiveTier('jdzelazny@gmail.com', 'free')).toBe('gold')
      expect(resolveEffectiveTier('jdzelazny@gmail.com', 'pro')).toBe('gold')
      expect(resolveEffectiveTier('jdzelazny@gmail.com', 'enterprise')).toBe('gold')
    })

    it('is case-insensitive and trims whitespace on the email match', () => {
      expect(resolveEffectiveTier('  JDZelazny@Gmail.com  ', 'free')).toBe('gold')
    })

    it('leaves every other account\'s stored tier untouched', () => {
      expect(resolveEffectiveTier('someone-else@example.com', 'free')).toBe('free')
      expect(resolveEffectiveTier('someone-else@example.com', 'pro')).toBe('pro')
      expect(resolveEffectiveTier('someone-else@example.com', 'enterprise')).toBe('enterprise')
    })
  })
})

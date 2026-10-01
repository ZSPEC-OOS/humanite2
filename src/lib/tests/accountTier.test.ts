import { describe, it, expect } from 'vitest'
import { GOLD_TIER, ACCOUNT_TIERS, isGoldTier, resolveEffectiveTier, isA2HAdmin } from '../accountTier'
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

  it('ACCOUNT_TIERS contains exactly free, starter, pro, enterprise, gold — no duplicates', () => {
    expect(ACCOUNT_TIERS).toEqual(['free', 'starter', 'pro', 'enterprise', 'gold'])
    expect(new Set(ACCOUNT_TIERS).size).toBe(ACCOUNT_TIERS.length)
  })

  describe('isGoldTier', () => {
    it('is true only for the gold tier', () => {
      expect(isGoldTier('gold')).toBe(true)
      expect(isGoldTier(GOLD_TIER)).toBe(true)
    })

    it('is false for every purchasable tier, null, undefined, and an unrecognized string', () => {
      expect(isGoldTier('free')).toBe(false)
      expect(isGoldTier('starter')).toBe(false)
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

  describe('isA2HAdmin', () => {
    it('is true only for the hardcoded Gold email when its tier is also gold', () => {
      expect(isA2HAdmin('jdzelazny@gmail.com', 'gold')).toBe(true)
      expect(isA2HAdmin('  JDZelazny@Gmail.com  ', 'gold')).toBe(true)
    })

    it('is false for the admin email if its tier is not gold', () => {
      // Guards against a stale/never-refreshed token issued before this
      // account was resolved to Gold, or any other path that could produce
      // that mismatch.
      expect(isA2HAdmin('jdzelazny@gmail.com', 'free')).toBe(false)
      expect(isA2HAdmin('jdzelazny@gmail.com', null)).toBe(false)
    })

    it('is false for a different gold-tier account, even though isGoldTier alone would be true', () => {
      // scripts/setAccountTier.ts can set tier='gold' on any Firestore user
      // independent of the GOLD_EMAILS allowlist — that must not by itself
      // grant access to internal benchmark tooling.
      expect(isGoldTier('gold')).toBe(true)
      expect(isA2HAdmin('someone-else@example.com', 'gold')).toBe(false)
    })

    it('is false for null/undefined/empty email', () => {
      expect(isA2HAdmin(null, 'gold')).toBe(false)
      expect(isA2HAdmin(undefined, 'gold')).toBe(false)
      expect(isA2HAdmin('', 'gold')).toBe(false)
    })
  })
})

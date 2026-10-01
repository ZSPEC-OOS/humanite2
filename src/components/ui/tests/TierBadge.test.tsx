import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { TierBadge } from '../TierBadge'

describe('TierBadge', () => {
  it('renders "Gold User" for a gold-tier account, not "Free User" or a plan label', () => {
    render(<TierBadge tier="gold" />)
    expect(screen.getByText('Gold User')).toBeTruthy()
    expect(screen.queryByText(/plan/i)).toBeNull()
    expect(screen.queryByText(/free user/i)).toBeNull()
  })

  it('applies the gold visual treatment (amber border/background/text) for gold', () => {
    render(<TierBadge tier="gold" />)
    const badge = screen.getByText('Gold User')
    expect(badge.className).toMatch(/amber/)
    expect(badge.className).not.toMatch(/\bgray-100\b/)
  })

  it('renders "Free Trial" (not "Free Plan") for a free-tier account, using the neutral (non-gold) treatment', () => {
    // Free is a one-time 30-day trial that ends, not a permanent plan —
    // "Free Plan" would misleadingly imply it never expires.
    render(<TierBadge tier="free" />)
    expect(screen.getByText('Free Trial')).toBeTruthy()
    expect(screen.queryByText('Free Plan')).toBeNull()
    const badge = screen.getByText('Free Trial')
    expect(badge.className).not.toMatch(/amber/)
  })

  it('renders the plan label for starter/pro/enterprise, unaffected by the Gold treatment', () => {
    render(<TierBadge tier="starter" />)
    expect(screen.getByText('Starter Plan')).toBeTruthy()

    render(<TierBadge tier="pro" />)
    expect(screen.getByText('Pro Plan')).toBeTruthy()

    render(<TierBadge tier="enterprise" />)
    expect(screen.getByText('Max Plan')).toBeTruthy()
  })

  it('falls back to "Free Trial" for an unrecognized or missing tier, rather than showing Gold or a paid plan', () => {
    render(<TierBadge tier={null} />)
    expect(screen.getByText('Free Trial')).toBeTruthy()

    render(<TierBadge tier="not-a-real-tier" />)
    expect(screen.getAllByText('Free Trial').length).toBeGreaterThan(0)
  })
})

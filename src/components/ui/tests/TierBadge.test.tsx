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

  it('renders the plan label for a free-tier account, using the neutral (non-gold) treatment', () => {
    render(<TierBadge tier="free" />)
    expect(screen.getByText('Starter Plan')).toBeTruthy()
    const badge = screen.getByText('Starter Plan')
    expect(badge.className).not.toMatch(/amber/)
  })

  it('renders the plan label for pro/enterprise, unaffected by the Gold treatment', () => {
    render(<TierBadge tier="pro" />)
    expect(screen.getByText('Pro Plan')).toBeTruthy()

    render(<TierBadge tier="enterprise" />)
    expect(screen.getByText('Max Plan')).toBeTruthy()
  })

  it('falls back to the Starter label for an unrecognized or missing tier, rather than showing Gold', () => {
    render(<TierBadge tier={null} />)
    expect(screen.getByText('Starter Plan')).toBeTruthy()

    render(<TierBadge tier="not-a-real-tier" />)
    expect(screen.getAllByText('Starter Plan').length).toBeGreaterThan(0)
  })
})

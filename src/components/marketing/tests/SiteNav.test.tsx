import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ThemeProvider } from '@/components/theme/ThemeProvider'
import { SiteNav } from '../SiteNav'

function renderSiteNav() {
  return render(<ThemeProvider><SiteNav /></ThemeProvider>)
}

describe('SiteNav', () => {
  it('shows a Developer link visible while logged out, alongside the other marketing nav items', () => {
    renderSiteNav()
    const links = screen.getAllByText('Developer')
    expect(links.length).toBeGreaterThan(0)
    // The desktop nav's Developer link points straight at /developer — the
    // page itself (not the nav) decides whether to bounce an unauthenticated
    // visitor to /auth/login?next=/developer, so this link never needs to
    // special-case auth state.
    expect(links[0]!.closest('a')).toHaveAttribute('href', '/developer')
  })

  it('still shows the existing Solutions/Pricing/About/Log in items unchanged', () => {
    renderSiteNav()
    expect(screen.getByText('Solutions')).toBeTruthy()
    expect(screen.getByText('Pricing')).toBeTruthy()
    expect(screen.getByText('About')).toBeTruthy()
    expect(screen.getAllByText('Log in').length).toBeGreaterThan(0)
  })

  it('renders Developer before Log in, matching the preferred menu order', () => {
    renderSiteNav()
    const nav = screen.getByText('Developer').closest('nav')!
    const labels = Array.from(nav.querySelectorAll('a')).map(a => a.textContent)
    expect(labels).toEqual(['Solutions', 'Pricing', 'About', 'Developer'])
  })

  it('includes Developer in the mobile hamburger menu', () => {
    renderSiteNav()
    // MobileNav receives [...NAV_LINKS, LOG_IN_LINK] — opening it exposes a
    // second "Developer" link (the desktop nav's own, hidden on mobile via
    // CSS, still exists in the DOM) inside the mobile drawer markup.
    const toggle = screen.getByLabelText('Open menu')
    fireEvent.click(toggle)
    const mobileNav = screen.getByRole('navigation', { name: 'Mobile' })
    expect(mobileNav.textContent).toContain('Developer')
  })
})

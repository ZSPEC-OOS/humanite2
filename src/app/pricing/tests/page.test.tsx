import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ThemeProvider } from '@/components/theme/ThemeProvider'
import PricingPage from '../page'

function renderPricingPage() {
  return render(<ThemeProvider><PricingPage /></ThemeProvider>)
}

// "Pricing Cleanup" patch §39: the page must expose all four public plans
// and must no longer claim every plan is paid from day one — a lightweight
// regression guard against the exact FAQ contradiction this patch fixes.
describe('PricingPage', () => {
  it('renders all four public plan names: Free, Starter, Pro, Max', () => {
    renderPricingPage()
    expect(screen.getByText('Free')).toBeTruthy()
    expect(screen.getByText('Starter')).toBeTruthy()
    expect(screen.getByText('Pro')).toBeTruthy()
    expect(screen.getByText('Max')).toBeTruthy()
  })

  it('never claims every plan is paid from day one', () => {
    renderPricingPage()
    expect(screen.queryByText(/all three plans are paid/i)).toBeNull()
  })

  it('states there is a real (non-trial) free plan in the FAQ', () => {
    renderPricingPage()
    expect(screen.getByText(/is there a free plan/i)).toBeTruthy()
    expect(screen.getByText(/5,000 generated words and 5,000 scanned words/i)).toBeTruthy()
  })

  it('shows Free\'s $0 price and Starter\'s $5 price distinctly', () => {
    renderPricingPage()
    expect(screen.getByText('$0')).toBeTruthy()
    expect(screen.getByText('$5')).toBeTruthy()
  })

  it('never displays the internal id "enterprise" as a plan name', () => {
    renderPricingPage()
    expect(screen.queryByText('enterprise')).toBeNull()
    expect(screen.queryByText('Enterprise')).toBeNull()
  })
})

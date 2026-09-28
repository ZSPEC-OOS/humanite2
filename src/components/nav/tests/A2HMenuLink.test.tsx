import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { A2HMenuLink } from '../A2HMenuLink'
import { useUserStore } from '@/stores/userStore'

afterEach(() => {
  act(() => { useUserStore.getState().clearAuth() })
})

describe('A2HMenuLink', () => {
  it('renders nothing when the session is not the A2H admin account', () => {
    act(() => { useUserStore.getState().setAuth('token', 'user-1', 'gold', 'us-east1', [], false) })
    const { container } = render(<A2HMenuLink />)
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing for a signed-out session', () => {
    const { container } = render(<A2HMenuLink />)
    expect(container.firstChild).toBeNull()
  })

  it('renders the link to /admin/a2h only when isA2HAdmin is true', () => {
    act(() => { useUserStore.getState().setAuth('token', 'user-jd', 'gold', 'us-east1', [], true) })
    render(<A2HMenuLink />)
    const link = screen.getByText('A2H Benchmark')
    expect(link.getAttribute('href')).toBe('/admin/a2h')
  })
})

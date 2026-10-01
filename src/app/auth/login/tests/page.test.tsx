import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const { push, searchParamsValue, authLoginMock } = vi.hoisted(() => ({
  push: vi.fn(),
  searchParamsValue: { value: '' as string | null },
  authLoginMock: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => ({ get: (key: string) => (key === 'next' ? searchParamsValue.value : null) }),
}))

vi.mock('@/lib/api', () => ({
  authLogin: authLoginMock,
  APIError: class APIError extends Error {},
}))

const LoginPage = (await import('../page')).default

beforeEach(() => {
  vi.clearAllMocks()
  searchParamsValue.value = ''
})

function fillAndSubmit() {
  fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'dev@example.com' } })
  fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'hunter22' } })
  fireEvent.click(screen.getByRole('button', { name: /sign in/i }))
}

describe('LoginPage — post-login return path', () => {
  it('redirects to the normal dashboard when no next param is present', async () => {
    authLoginMock.mockResolvedValue({})
    render(<LoginPage />)
    fillAndSubmit()
    await waitFor(() => expect(push).toHaveBeenCalledWith('/dashboard'))
  })

  it('redirects to /developer after login when ?next=/developer is present', async () => {
    searchParamsValue.value = '/developer'
    authLoginMock.mockResolvedValue({})
    render(<LoginPage />)
    fillAndSubmit()
    await waitFor(() => expect(push).toHaveBeenCalledWith('/developer'))
  })

  it('falls back to /dashboard for an unsafe external next value, never navigating off-site', async () => {
    searchParamsValue.value = 'https://malicious-site.com'
    authLoginMock.mockResolvedValue({})
    render(<LoginPage />)
    fillAndSubmit()
    await waitFor(() => expect(push).toHaveBeenCalledWith('/dashboard'))
    expect(push).not.toHaveBeenCalledWith(expect.stringContaining('malicious-site.com'))
  })

  it('falls back to /dashboard for a protocol-relative next value', async () => {
    searchParamsValue.value = '//malicious-site.com'
    authLoginMock.mockResolvedValue({})
    render(<LoginPage />)
    fillAndSubmit()
    await waitFor(() => expect(push).toHaveBeenCalledWith('/dashboard'))
  })

  it('carries a safe next value forward into the "Create one" register link', () => {
    searchParamsValue.value = '/developer'
    render(<LoginPage />)
    const link = screen.getByText('Create one').closest('a')!
    expect(link.getAttribute('href')).toBe('/auth/register?next=%2Fdeveloper')
  })

  it('never redirects at all if login fails', async () => {
    authLoginMock.mockRejectedValue(new Error('bad credentials'))
    render(<LoginPage />)
    fillAndSubmit()
    await waitFor(() => expect(authLoginMock).toHaveBeenCalled())
    expect(push).not.toHaveBeenCalled()
  })
})

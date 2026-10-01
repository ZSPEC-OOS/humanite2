import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const { push, searchParamsValue, authRegisterMock } = vi.hoisted(() => ({
  push: vi.fn(),
  searchParamsValue: { value: '' as string | null },
  authRegisterMock: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => ({ get: (key: string) => (key === 'next' ? searchParamsValue.value : null) }),
}))

vi.mock('@/lib/api', () => ({
  authRegister: authRegisterMock,
  APIError: class APIError extends Error {},
}))

const RegisterPage = (await import('../page')).default

beforeEach(() => {
  vi.clearAllMocks()
  searchParamsValue.value = ''
})

function fillAndSubmit() {
  fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'dev@example.com' } })
  fireEvent.change(screen.getByPlaceholderText('Password (min. 8 chars)'), { target: { value: 'hunter22' } })
  fireEvent.change(screen.getByPlaceholderText('Confirm password'), { target: { value: 'hunter22' } })
  fireEvent.click(screen.getByRole('button', { name: /create account/i }))
}

describe('RegisterPage — post-registration return path', () => {
  it('redirects to /developer after registering when ?next=/developer is present', async () => {
    searchParamsValue.value = '/developer'
    authRegisterMock.mockResolvedValue({})
    render(<RegisterPage />)
    fillAndSubmit()
    await waitFor(() => expect(push).toHaveBeenCalledWith('/developer'))
  })

  it('falls back to /dashboard for an unsafe external next value', async () => {
    searchParamsValue.value = 'https://malicious-site.com'
    authRegisterMock.mockResolvedValue({})
    render(<RegisterPage />)
    fillAndSubmit()
    await waitFor(() => expect(push).toHaveBeenCalledWith('/dashboard'))
  })

  it('carries a safe next value forward into the "Sign in" login link', () => {
    searchParamsValue.value = '/developer'
    render(<RegisterPage />)
    const link = screen.getByText('Sign in').closest('a')!
    expect(link.getAttribute('href')).toBe('/auth/login?next=%2Fdeveloper')
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { ThemeProvider } from '@/components/theme/ThemeProvider'

const { replace, push, isAuthenticatedMock, restoreSessionMock, apiGetUsageSummaryMock, clearAuthMock } = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
  isAuthenticatedMock: vi.fn(),
  restoreSessionMock: vi.fn(),
  apiGetUsageSummaryMock: vi.fn(),
  clearAuthMock: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push }),
}))

vi.mock('@/stores/userStore', () => {
  const state = { isAuthenticated: isAuthenticatedMock, clearAuth: clearAuthMock }
  const useUserStore = (selector?: (s: typeof state) => unknown) => (selector ? selector(state) : state)
  useUserStore.getState = () => state
  return { useUserStore }
})

vi.mock('@/lib/api', () => ({
  restoreSession: restoreSessionMock,
  apiGetUsageSummary: apiGetUsageSummaryMock,
}))

const DeveloperPage = (await import('../page')).default

function renderDeveloperPage() {
  return render(<ThemeProvider><DeveloperPage /></ThemeProvider>)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('DeveloperPage — auth guard', () => {
  it('redirects a logged-out visitor to /auth/login?next=/developer, never rendering page content', async () => {
    isAuthenticatedMock.mockReturnValue(false)
    restoreSessionMock.mockResolvedValue(null)

    renderDeveloperPage()

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/auth/login?next=/developer'))
    expect(screen.queryByText('Developer')).toBeNull()
    expect(apiGetUsageSummaryMock).not.toHaveBeenCalled()
  })

  it('tries a silent session restore before giving up, so a reloaded-but-still-logged-in tab is not bounced', async () => {
    isAuthenticatedMock.mockReturnValue(false)
    restoreSessionMock.mockResolvedValue('new-token')
    // After restoreSession "succeeds", the store reports authenticated.
    isAuthenticatedMock.mockImplementation(() => restoreSessionMock.mock.calls.length > 0)
    apiGetUsageSummaryMock.mockResolvedValue({
      tier: 'free', planName: 'Free', unlimited: false, available: true,
      generation: { used: 0, limit: 1200 }, scan: { used: 0, limit: 1200 },
    })

    renderDeveloperPage()

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Developer' })).toBeTruthy())
    expect(replace).not.toHaveBeenCalled()
  })
})

describe('DeveloperPage — authenticated rendering', () => {
  beforeEach(() => {
    isAuthenticatedMock.mockReturnValue(true)
  })

  it('renders the header, heading, subtitle, and a subtle logged-in indicator', async () => {
    apiGetUsageSummaryMock.mockResolvedValue({
      tier: 'starter', planName: 'Starter', unlimited: false, available: true,
      generation: { used: 500, limit: 50_000 }, scan: { used: 100, limit: 50_000 },
    })
    renderDeveloperPage()

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Developer' })).toBeTruthy())
    expect(screen.getByText('Build Humanite into your app.')).toBeTruthy()
    expect(screen.getByText('Logged in')).toBeTruthy()
  })

  it('shows the empty API-key state with a non-functional Create API Key affordance', async () => {
    apiGetUsageSummaryMock.mockResolvedValue({
      tier: 'free', planName: 'Free', unlimited: false, available: true,
      generation: { used: 0, limit: 1200 }, scan: { used: 0, limit: 1200 },
    })
    renderDeveloperPage()

    await waitFor(() => expect(screen.getByText('No API keys yet.')).toBeTruthy())
    expect(screen.getByRole('heading', { name: 'API Keys' })).toBeTruthy()
  })

  it('renders real usage numbers from apiGetUsageSummary rather than placeholder/fake data', async () => {
    apiGetUsageSummaryMock.mockResolvedValue({
      tier: 'pro', planName: 'Pro', unlimited: false, available: true,
      generation: { used: 12_480, limit: 100_000 }, scan: { used: 8_120, limit: 100_000 },
    })
    renderDeveloperPage()

    await waitFor(() => expect(screen.getByText('12,480 / 100,000')).toBeTruthy())
    expect(screen.getByText('8,120 / 100,000')).toBeTruthy()
    expect(screen.getByText('Pro')).toBeTruthy()
  })

  it('shows an unavailable state rather than fabricating usage numbers when the usage fetch fails', async () => {
    apiGetUsageSummaryMock.mockRejectedValue(new Error('network error'))
    renderDeveloperPage()

    await waitFor(() => expect(screen.getByText(/usage data is temporarily unavailable/i)).toBeTruthy())
  })

  it('includes the Quick Start curl example and a copy button', async () => {
    apiGetUsageSummaryMock.mockResolvedValue({
      tier: 'free', planName: 'Free', unlimited: false, available: true,
      generation: { used: 0, limit: 1200 }, scan: { used: 0, limit: 1200 },
    })
    renderDeveloperPage()

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Quick Start' })).toBeTruthy())
    expect(screen.getByText(/api\.humanite\.ai\/v1\/humanize/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy()
  })
})

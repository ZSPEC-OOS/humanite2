import { test, expect, Page } from '@playwright/test'

// ── Helpers ────────────────────────────────────────────────────────────────────

// Login is a real credential gate (no auto-auth) — each test registers its own
// throwaway user via the UI, since there is no seeded test account.
function uniqueEmail() {
  return `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`
}

async function registerAndGoToDashboard(page: Page, email: string, password = 'e2e-test-password') {
  await page.goto('/auth/register')
  await page.getByPlaceholder('Email').fill(email)
  await page.getByPlaceholder('Password (min. 8 chars)').fill(password)
  await page.getByPlaceholder('Confirm password').fill(password)
  await page.getByRole('button', { name: /create account/i }).click()
  await page.waitForURL('/dashboard', { timeout: 15_000 })
}

// ── Auth guard ─────────────────────────────────────────────────────────────────

test.describe('Auth guard', () => {
  test('unauthenticated /dashboard redirects to login', async ({ page }) => {
    await page.goto('/dashboard')
    await expect(page).toHaveURL('/auth/login', { timeout: 8_000 })
  })

  test('registered user can log back in with the same credentials', async ({ page }) => {
    const email = uniqueEmail()
    const password = 'e2e-test-password'
    await registerAndGoToDashboard(page, email, password)

    await page.getByRole('button', { name: /sign out/i }).click()
    await expect(page).toHaveURL('/auth/login', { timeout: 8_000 })

    await page.getByPlaceholder('Email').fill(email)
    await page.getByPlaceholder('Password').fill(password)
    await page.getByRole('button', { name: /sign in/i }).click()
    await expect(page).toHaveURL('/dashboard', { timeout: 15_000 })
  })
})

// ── Dashboard layout ───────────────────────────────────────────────────────────

test.describe('Dashboard layout', () => {
  test.beforeEach(async ({ page }) => {
    await registerAndGoToDashboard(page, uniqueEmail())
  })

  test('renders Humanite brand in top bar', async ({ page }) => {
    await expect(page.getByText('Humanite').first()).toBeVisible()
  })

  test('renders tier badge in header', async ({ page }) => {
    const badge = page.locator('span').filter({ hasText: /free|pro|enterprise/i })
    await expect(badge.first()).toBeVisible()
  })

  test('renders Sign out button', async ({ page }) => {
    await expect(page.getByRole('button', { name: /sign out/i })).toBeVisible()
  })

  test('shows input placeholder when no text entered', async ({ page }) => {
    await expect(page.getByPlaceholder(/paste your ai-generated text/i)).toBeVisible()
  })

  test('shows output placeholder when no humanization done', async ({ page }) => {
    await expect(page.getByText(/your humanized text will appear here/i)).toBeVisible()
  })
})

// ── Control panel interactions ─────────────────────────────────────────────────

test.describe('Control panel', () => {
  test.beforeEach(async ({ page }) => {
    await registerAndGoToDashboard(page, uniqueEmail())
  })

  test('Humanize button is present', async ({ page }) => {
    await expect(page.getByRole('button', { name: /humanize/i })).toBeVisible()
  })

  test('Scan button is present', async ({ page }) => {
    await expect(page.getByRole('button', { name: /scan/i })).toBeVisible()
  })

  test('intensity slider is present', async ({ page }) => {
    await expect(page.getByRole('slider')).toBeVisible()
  })

  test('save preset button is visible', async ({ page }) => {
    await expect(page.getByText(/save preset/i)).toBeVisible()
  })
})

// ── Sign out flow ─────────────────────────────────────────────────────────────

test.describe('Sign out', () => {
  test('sign out button redirects to login', async ({ page }) => {
    await registerAndGoToDashboard(page, uniqueEmail())
    await page.getByRole('button', { name: /sign out/i }).click()
    await expect(page).toHaveURL('/auth/login', { timeout: 8_000 })
  })
})

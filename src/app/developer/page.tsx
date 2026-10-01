'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useUserStore } from '@/stores/userStore'
import { restoreSession, apiGetUsageSummary, type UsageSummary } from '@/lib/api'
import { Logo } from '@/components/ui/Logo'
import { Spinner } from '@/components/ui/Spinner'
import { ThemeToggle } from '@/components/theme/ThemeToggle'
import { SiteFooter } from '@/components/marketing/SiteFooter'

const CARD = 'rounded-2xl border border-gray-200 bg-white p-6 dark:border-gray-800 dark:bg-gray-900'

const PRIMARY_BTN =
  'inline-flex items-center justify-center rounded-full bg-gray-900 px-5 py-2 text-sm font-semibold text-white ' +
  'transition-colors hover:bg-gray-800 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white'

// Styled identically to a button but rendered as a non-interactive span —
// these point at destinations (docs) that don't exist yet, so they must
// read as "not available yet" rather than being clickable and 404ing.
const DISABLED_BTN =
  'inline-flex cursor-not-allowed items-center justify-center rounded-full border border-gray-200 px-5 py-2 ' +
  'text-sm font-semibold text-gray-400 dark:border-gray-800 dark:text-gray-600'

const CURL_EXAMPLE = `curl https://api.humanite.ai/v1/humanize \\
  -H "Authorization: Bearer $HUMANITE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "text": "Your draft here",
    "intensity": 5
  }'`

function ProgressBar({ used, limit }: { used: number; limit: number | null }) {
  if (limit == null) {
    // Unlimited (Gold / allowlisted) — a full, static bar rather than a
    // fraction that would misleadingly imply a ceiling exists.
    return <div className="h-1.5 w-full rounded-full bg-gray-900 dark:bg-gray-100" />
  }
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 100
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
      <div className="h-full rounded-full bg-gray-900 dark:bg-gray-100" style={{ width: `${pct}%` }} />
    </div>
  )
}

function UsageRow({ label, pool }: { label: string; pool: { used: number; limit: number | null } }) {
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-gray-600 dark:text-gray-400">{label}</span>
        <span className="font-medium text-gray-900 dark:text-gray-100">
          {pool.limit == null
            ? `${pool.used.toLocaleString()} · Unlimited`
            : `${pool.used.toLocaleString()} / ${pool.limit.toLocaleString()}`}
        </span>
      </div>
      <div className="mt-1.5">
        <ProgressBar used={pool.used} limit={pool.limit} />
      </div>
    </div>
  )
}

export default function DeveloperPage() {
  const { isAuthenticated, clearAuth } = useUserStore()
  const router = useRouter()
  const [authReady, setAuthReady] = useState(false)
  const [usage, setUsage] = useState<UsageSummary | null>(null)
  const [usageFailed, setUsageFailed] = useState(false)
  const [keyComingSoon, setKeyComingSoon] = useState(false)
  const [curlCopied, setCurlCopied] = useState(false)

  // Same silent-refresh-then-redirect guard dashboard/page.tsx uses — an
  // in-memory-only access token doesn't survive a reload, so a logged-in
  // user whose tab was just refreshed shouldn't get bounced to login before
  // restoreSession has a chance to redeem their refresh token. `next`
  // carries this page's own path so a successful login lands back here
  // (see safeRedirect.ts / auth/login/page.tsx) instead of the default
  // dashboard.
  useEffect(() => {
    let cancelled = false
    async function checkAuth() {
      if (!isAuthenticated()) await restoreSession()
      if (cancelled) return
      if (!useUserStore.getState().isAuthenticated()) {
        router.replace('/auth/login?next=/developer')
        return
      }
      setAuthReady(true)
    }
    checkAuth()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!authReady) return
    let cancelled = false
    apiGetUsageSummary()
      .then(summary => { if (!cancelled) setUsage(summary) })
      .catch(() => { if (!cancelled) setUsageFailed(true) })
    return () => { cancelled = true }
  }, [authReady])

  const handleSignOut = () => {
    clearAuth()
    if (typeof window !== 'undefined') sessionStorage.removeItem('__rt')
    router.push('/auth/login')
  }

  const handleCopyCurl = () => {
    navigator.clipboard.writeText(CURL_EXAMPLE).then(() => {
      setCurlCopied(true)
      setTimeout(() => setCurlCopied(false), 2000)
    })
  }

  if (!authReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white dark:bg-gray-950">
        <Spinner className="h-8 w-8 border-gray-200 border-t-gray-700 dark:border-gray-700 dark:border-t-gray-300" />
      </div>
    )
  }

  return (
    <main className="min-h-screen bg-white dark:bg-gray-950">
      <div className="flex min-h-screen flex-col">
        <header className="flex items-center justify-between px-6 py-6 md:px-14 md:py-7">
          <Link href="/" className="flex items-center">
            <Logo className="h-6" />
          </Link>
          <div className="flex items-center gap-2 md:gap-4">
            <Link href="/dashboard" className="hidden text-sm font-medium text-gray-700 hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-100 sm:block">
              Dashboard
            </Link>
            <ThemeToggle />
            <button
              onClick={handleSignOut}
              className="text-sm font-medium text-gray-700 hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-100"
            >
              Sign out
            </button>
          </div>
        </header>

        <div className="flex-1 px-6 pb-20 md:px-14">
          <div className="mx-auto max-w-2xl">
            <h1 className="font-display text-4xl font-bold text-gray-900 dark:text-gray-100 md:text-5xl">Developer</h1>
            <p className="mt-2 text-base text-gray-600 dark:text-gray-400">Build Humanite into your app.</p>
            <p className="mt-3 flex items-center gap-1.5 text-xs text-gray-400 dark:text-gray-500">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
              Logged in
            </p>

            {/* Get Started */}
            <section className={`${CARD} mt-8`}>
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Get Started</h2>
              <p className="mt-1.5 text-sm text-gray-600 dark:text-gray-400">
                Create an API key to start building with Humanite.
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <a href="#api-keys" className={PRIMARY_BTN}>Create API Key</a>
                <span className={DISABLED_BTN} title="API documentation is coming soon" aria-disabled="true">
                  View Docs
                </span>
              </div>
            </section>

            {/* API Keys */}
            <section id="api-keys" className={`${CARD} mt-6`}>
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">API Keys</h2>
              <div className="mt-4 rounded-xl border border-dashed border-gray-200 px-5 py-8 text-center dark:border-gray-700">
                <p className="text-sm text-gray-500 dark:text-gray-400">No API keys yet.</p>
                <p className="mt-1.5 text-xs text-gray-400 dark:text-gray-500">
                  Keys will look like{' '}
                  <code className="rounded bg-gray-100 px-1 py-0.5 font-mono text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                    hm_live_••••••••••••abc1
                  </code>{' '}
                  once available.
                </p>
                <button onClick={() => setKeyComingSoon(true)} className={`${PRIMARY_BTN} mt-4`}>
                  Create API Key
                </button>
                {keyComingSoon && (
                  <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
                    Humanite API keys are coming soon — nothing was created. We&apos;ll let you know when this is ready.
                  </p>
                )}
              </div>
            </section>

            {/* Usage This Month */}
            <section className={`${CARD} mt-6`}>
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Usage This Month</h2>
              {!usage && !usageFailed && (
                <div className="mt-4 flex items-center gap-2 text-sm text-gray-400 dark:text-gray-500">
                  <Spinner className="h-3.5 w-3.5 border-gray-300 border-t-gray-600 dark:border-gray-700 dark:border-t-gray-300" />
                  Loading usage…
                </div>
              )}
              {usageFailed && (
                <p className="mt-4 text-sm text-gray-500 dark:text-gray-400">
                  Usage data is temporarily unavailable. Try again shortly.
                </p>
              )}
              {usage && (
                <div className="mt-4 space-y-4">
                  <UsageRow label="Generated words" pool={usage.generation} />
                  <UsageRow label="Scanned words" pool={usage.scan} />
                  <div className="flex items-center justify-between border-t border-gray-100 pt-4 text-sm dark:border-gray-800">
                    <span className="text-gray-600 dark:text-gray-400">
                      API requests
                      <span className="ml-1.5 text-[11px] text-gray-400 dark:text-gray-500">(via API key — coming soon)</span>
                    </span>
                    <span className="font-medium text-gray-900 dark:text-gray-100">0</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-600 dark:text-gray-400">Plan</span>
                    <span className="font-medium text-gray-900 dark:text-gray-100">{usage.planName}</span>
                  </div>
                </div>
              )}
            </section>

            {/* Quick Start */}
            <section className={`${CARD} mb-10 mt-6`}>
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">Quick Start</h2>
              <p className="mt-1.5 text-sm text-gray-600 dark:text-gray-400">
                Make your first request to Humanite&apos;s API.
              </p>
              <div className="relative mt-4">
                <pre className="overflow-x-auto rounded-xl bg-gray-900 p-4 text-xs leading-relaxed text-gray-100 dark:bg-black">
                  <code>{CURL_EXAMPLE}</code>
                </pre>
                <button
                  onClick={handleCopyCurl}
                  className="absolute right-2 top-2 rounded-lg bg-gray-800 px-2.5 py-1 text-[11px] font-medium text-gray-300 transition-colors hover:bg-gray-700"
                >
                  {curlCopied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <p className="mt-3 text-xs text-gray-400 dark:text-gray-500">
                Example request format — api.humanite.ai isn&apos;t live yet, and Humanite API keys aren&apos;t issued yet either.
              </p>
              <span
                className="mt-3 inline-block cursor-not-allowed text-sm font-medium text-gray-400 dark:text-gray-600"
                title="API documentation is coming soon"
                aria-disabled="true"
              >
                View full API reference →
              </span>
            </section>
          </div>
        </div>

        <SiteFooter />
      </div>
    </main>
  )
}

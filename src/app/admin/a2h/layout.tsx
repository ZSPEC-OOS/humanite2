'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useUserStore } from '@/stores/userStore'
import { restoreSession } from '@/lib/api'
import { Spinner } from '@/components/ui/Spinner'

// Client-side only — a UX convenience that keeps a non-admin session from
// ever seeing this route render, not the access boundary itself. The real
// boundary is server-side: every /api/admin/benchmark/** route this area
// calls must independently verify requireAuth()'s claims.a2h_admin, the
// same signed claim this layout reads, rather than trusting anything the
// browser sends.
export default function A2HAdminLayout({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false)
  const router = useRouter()

  useEffect(() => {
    let cancelled = false
    async function checkAccess() {
      if (!useUserStore.getState().isAuthenticated()) await restoreSession()
      if (cancelled) return
      const current = useUserStore.getState()
      if (!current.isAuthenticated() || !current.isA2HAdmin) {
        router.replace('/dashboard')
        return
      }
      setReady(true)
    }
    checkAccess()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white dark:bg-gray-950">
        <Spinner className="w-8 h-8 border-gray-200 border-t-gray-700 dark:border-gray-700 dark:border-t-gray-300" />
      </div>
    )
  }

  return <>{children}</>
}

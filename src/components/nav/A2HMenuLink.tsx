import Link from 'next/link'
import { useUserStore } from '@/stores/userStore'

interface A2HMenuLinkProps {
  onClick?: () => void
  className?: string
}

// The one place the A2H benchmark entry point is rendered, so the desktop
// header and mobile drawer (the two places dashboard/page.tsx renders menu
// items) stay in sync rather than duplicating the isA2HAdmin check twice.
// Renders nothing for every account except the Gold admin account isA2HAdmin
// is signed for — see accountTier.ts's isA2HAdmin and auth-utils.ts's
// issueAccessToken. This is a UX convenience only: the real access boundary
// is server-side, on the /admin/a2h routes and their backing API routes.
export function A2HMenuLink({ onClick = () => {}, className = '' }: A2HMenuLinkProps) {
  const isA2HAdmin = useUserStore(s => s.isA2HAdmin)
  if (!isA2HAdmin) return null

  return (
    <Link
      href="/admin/a2h"
      onClick={onClick}
      className={`${className} text-sm text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100`}
    >
      A2H Benchmark
    </Link>
  )
}

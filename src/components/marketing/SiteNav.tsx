import Link from 'next/link'
import { ThemeToggle } from '@/components/theme/ThemeToggle'
import { Logo } from '@/components/ui/Logo'
import { MobileNav } from './MobileNav'

const NAV_LINKS = [
  { label: 'Solutions', href: '/solutions' },
  { label: 'Pricing', href: '/pricing' },
  { label: 'About', href: '/about' },
  // Visible whether logged in or out — /developer itself handles the
  // authenticated/unauthenticated split (see src/app/developer/page.tsx's
  // own auth guard, which sends a logged-out visitor to
  // /auth/login?next=/developer).
  { label: 'Developer', href: '/developer' },
]

const LOG_IN_LINK = { label: 'Log in', href: '/auth/login' }

export function SiteNav() {
  return (
    <header className="relative z-10 flex items-center justify-between px-6 py-6 md:px-14 md:py-7">
      <Link href="/" className="flex items-center">
        <Logo className="h-6" />
      </Link>

      <nav className="hidden items-center gap-8 md:flex">
        {NAV_LINKS.map(item => (
          <Link key={item.href} href={item.href} className="text-sm font-medium text-gray-700 hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-100">
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="flex items-center gap-2 md:gap-4">
        <Link href={LOG_IN_LINK.href} className="hidden text-sm font-medium text-gray-700 hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-100 sm:block">
          {LOG_IN_LINK.label}
        </Link>
        <ThemeToggle />
        <MobileNav links={[...NAV_LINKS, LOG_IN_LINK]} />
      </div>
    </header>
  )
}

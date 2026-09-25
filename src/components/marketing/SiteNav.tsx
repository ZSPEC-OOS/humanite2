import Link from 'next/link'
import { ThemeToggle } from '@/components/theme/ThemeToggle'

const NAV_LINKS = [
  { label: 'Product', href: '/product' },
  { label: 'Use Cases', href: '/use-cases' },
  { label: 'Pricing', href: '/pricing' },
  { label: 'About', href: '/about' },
]

export function SiteNav() {
  return (
    <header className="relative z-10 flex items-center justify-between px-6 py-6 md:px-14 md:py-7">
      <Link href="/" className="font-display text-xl text-gray-900 dark:text-gray-100">
        Humanite
      </Link>

      <nav className="hidden items-center gap-8 md:flex">
        {NAV_LINKS.map(item => (
          <Link key={item.href} href={item.href} className="text-sm font-medium text-gray-700 hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-100">
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="flex items-center gap-4">
        <Link href="/auth/login" className="hidden text-sm font-medium text-gray-700 hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-100 sm:block">
          Log in
        </Link>
        <ThemeToggle />
      </div>
    </header>
  )
}

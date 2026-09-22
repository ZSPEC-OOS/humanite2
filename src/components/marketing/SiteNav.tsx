import Link from 'next/link'
import { ArrowIcon } from './icons'

const NAV_LINKS = [
  { label: 'Product', href: '/product' },
  { label: 'Use Cases', href: '/use-cases' },
  { label: 'Pricing', href: '/pricing' },
  { label: 'About', href: '/about' },
]

export function SiteNav() {
  return (
    <header className="relative z-10 flex items-center justify-between px-6 py-6 md:px-14 md:py-7">
      <Link href="/" className="font-display text-xl text-gray-900">
        Humanite<sup className="text-[0.55em]">™</sup>
      </Link>

      <nav className="hidden items-center gap-8 md:flex">
        {NAV_LINKS.map(item => (
          <Link key={item.href} href={item.href} className="text-sm font-medium text-gray-700 hover:text-gray-900">
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="flex items-center gap-4">
        <Link href="/auth/login" className="hidden text-sm font-medium text-gray-700 hover:text-gray-900 sm:block">
          Log in
        </Link>
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 rounded-full bg-gray-900 px-5 py-2.5
                     text-sm font-semibold text-white transition-colors hover:bg-gray-800"
        >
          Get Started
          <ArrowIcon />
        </Link>
      </div>
    </header>
  )
}

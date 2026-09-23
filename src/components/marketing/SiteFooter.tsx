import Link from 'next/link'

const FOOTER_LINKS = [
  { label: 'Product', href: '/product' },
  { label: 'Use Cases', href: '/use-cases' },
  { label: 'Pricing', href: '/pricing' },
  { label: 'About', href: '/about' },
]

export function SiteFooter() {
  return (
    <footer className="border-t border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950">
      <div className="mx-auto flex max-w-5xl flex-col items-center gap-6 px-6 py-10 text-center md:flex-row md:justify-between md:text-left">
        <div>
          <span className="font-display text-lg text-gray-900 dark:text-gray-100">
            Humanite
          </span>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-500">More human ideas for a brighter tomorrow.</p>
        </div>
        <nav className="flex flex-wrap items-center justify-center gap-6">
          {FOOTER_LINKS.map(item => (
            <Link key={item.href} href={item.href} className="text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100">
              {item.label}
            </Link>
          ))}
        </nav>
        <p className="text-xs text-gray-400 dark:text-gray-600">© {new Date().getFullYear()} Humanite. All rights reserved.</p>
      </div>
    </footer>
  )
}

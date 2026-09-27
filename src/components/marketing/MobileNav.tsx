'use client'
import { useEffect, useId, useRef, useState } from 'react'
import Link from 'next/link'
import { MenuIcon, CloseIcon } from './icons'

interface NavItem {
  label: string
  href: string
}

interface MobileNavProps {
  links: NavItem[]
}

export function MobileNav({ links }: MobileNavProps) {
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const containerRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const firstLinkRef = useRef<HTMLAnchorElement>(null)

  useEffect(() => {
    if (!open) return
    firstLinkRef.current?.focus()

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    function handlePointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('mousedown', handlePointerDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('mousedown', handlePointerDown)
    }
  }, [open])

  return (
    <div ref={containerRef} className="relative md:hidden">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={open ? 'Close menu' : 'Open menu'}
        className="inline-flex h-9 w-9 items-center justify-center rounded-full text-gray-500
                   transition-colors hover:bg-gray-100 hover:text-gray-900
                   focus:outline-none focus:ring-2 focus:ring-gray-900/20
                   dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100 dark:focus:ring-gray-100/20"
      >
        {open ? <CloseIcon /> : <MenuIcon />}
      </button>

      {open && (
        <nav
          id={panelId}
          aria-label="Mobile"
          className="absolute right-0 top-full z-20 mt-2 w-48 rounded-2xl border border-gray-200
                     bg-white p-2 shadow-lg dark:border-gray-800 dark:bg-gray-900"
        >
          {links.map((item, index) => (
            <Link
              key={item.href}
              href={item.href}
              ref={index === 0 ? firstLinkRef : undefined}
              onClick={() => setOpen(false)}
              className="block rounded-xl px-4 py-2.5 text-sm font-medium text-gray-700
                         hover:bg-gray-100 hover:text-gray-900
                         dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-gray-100"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      )}
    </div>
  )
}

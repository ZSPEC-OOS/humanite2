'use client'
import { useTheme } from './ThemeProvider'

function SunIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="5" stroke="currentColor" strokeWidth="2" />
      <path
        d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round"
      />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  )
}

interface ThemeToggleProps {
  className?: string
}

export function ThemeToggle({ className = 'w-9 h-9' }: ThemeToggleProps) {
  const { theme, toggleTheme } = useTheme()
  const isDark = theme === 'dark'

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      className={
        `inline-flex items-center justify-center rounded-full transition-colors shrink-0
         text-gray-500 hover:text-gray-900 hover:bg-gray-100
         dark:text-gray-400 dark:hover:text-gray-100 dark:hover:bg-gray-800
         focus:outline-none focus:ring-2 focus:ring-gray-900/20 dark:focus:ring-gray-100/20 ${className}`
      }
    >
      {isDark ? <SunIcon /> : <MoonIcon />}
    </button>
  )
}

interface LogoProps {
  /** Height + any other sizing utility classes — width follows automatically (the asset is a fixed-ratio wordmark). */
  className?: string
}

// The wordmark image (light/dark pair — see /public/humanite-logo-*.webp),
// used wherever the plain "Humanite" text logotype previously stood in for
// it (nav, footer, auth cards) — the same asset the homepage hero already
// renders at a much larger size, just sized to sit in place of that text.
export function Logo({ className = 'h-7' }: LogoProps) {
  return (
    <>
      <img src="/humanite-logo-light.webp" alt="Humanite" className={`${className} w-auto dark:hidden`} />
      <img src="/humanite-logo-dark.webp" alt="Humanite" className={`${className} hidden w-auto dark:block`} />
    </>
  )
}

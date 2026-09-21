interface SpinnerProps {
  className?: string
}

export function Spinner({ className = 'w-4 h-4 border-white' }: SpinnerProps) {
  return (
    <span
      aria-label="Loading"
      className={`inline-block rounded-full border-2 border-t-transparent animate-spin ${className}`}
    />
  )
}

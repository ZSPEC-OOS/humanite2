'use client'
import { useState } from 'react'

interface Props {
  plan: string
  children: React.ReactNode
  className?: string
}

export function CheckoutButton({ plan, children, className }: Props) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleClick = async () => {
    setLoading(true)
    setError(null)
    try {
      const resp = await fetch('/api/v1/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan }),
      })
      const data = await resp.json()
      if (!resp.ok) throw new Error(data.error?.message ?? 'Checkout is not available yet.')
      if (data.url) window.location.href = data.url
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Checkout is not available yet.')
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <button onClick={handleClick} disabled={loading} className={className}>
        {loading ? 'Redirecting…' : children}
      </button>
      {error && <p className="max-w-xs text-center text-xs text-red-500">{error}</p>}
    </div>
  )
}

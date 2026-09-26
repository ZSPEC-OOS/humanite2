'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { authRegister, APIError } from '@/lib/api'
import { Spinner } from '@/components/ui/Spinner'
import { inputCls } from '@/components/ui/styles'
import { Logo } from '@/components/ui/Logo'

export default function RegisterPage() {
  const [email, setEmail]     = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError]     = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setLoading(true)
    setError(null)
    try {
      // authRegister adopts the session (userStore + refresh token) itself.
      await authRegister(email, password)
      router.push('/dashboard')
    } catch (e) {
      setError(e instanceof APIError ? e.message : 'Registration failed.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-rock min-h-screen flex items-center justify-center bg-white dark:bg-gray-950">
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-10 w-full max-w-sm dark:bg-gray-900 dark:border-gray-800">
        <div className="flex items-center justify-center mb-8">
          <Link href="/" className="flex items-center">
            <Logo className="h-6" />
          </Link>
        </div>

        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-1 text-center">Create account</h1>
        <p className="text-xs text-gray-500 dark:text-gray-400 text-center mb-6">Join Humanite today</p>

        {error && (
          <div className="mb-4 p-3 bg-gray-50 border border-gray-200
                          rounded-xl text-sm font-medium text-gray-900
                          dark:bg-gray-800 dark:border-gray-700 dark:text-gray-100">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="email"
            required
            placeholder="Email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            className={`${inputCls} w-full`}
          />
          <input
            type="password"
            required
            placeholder="Password (min. 8 chars)"
            value={password}
            onChange={e => setPassword(e.target.value)}
            className={`${inputCls} w-full`}
          />
          <input
            type="password"
            required
            placeholder="Confirm password"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            className={`${inputCls} w-full`}
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-xl text-sm font-semibold text-white
                       bg-gray-900 hover:bg-gray-800 disabled:opacity-40 transition-colors mt-2
                       dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <Spinner className="w-3 h-3 border-white dark:border-gray-900" />
                Creating account…
              </span>
            ) : 'Create account'}
          </button>
        </form>

        <p className="mt-5 text-xs text-center text-gray-400 dark:text-gray-500">
          Already have an account?{' '}
          <a href="/auth/login" className="text-gray-900 dark:text-gray-100 font-medium hover:opacity-70">
            Sign in
          </a>
        </p>
      </div>
    </div>
  )
}

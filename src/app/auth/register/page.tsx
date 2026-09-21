'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useUserStore } from '@/stores/userStore'
import { authRegister, APIError } from '@/lib/api'
import { jwtDecode } from 'jwt-decode'
import { Spinner } from '@/components/ui/Spinner'
import { inputCls } from '@/components/ui/styles'

interface JWTClaims {
  sub: string
  tier: string
  region: string
  scopes: string[]
}

export default function RegisterPage() {
  const [email, setEmail]     = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError]     = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const { setAuth } = useUserStore()
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
      const data   = await authRegister(email, password)
      const claims = jwtDecode<JWTClaims>(data.access_token)
      setAuth(data.access_token, claims.sub, claims.tier, claims.region, claims.scopes)
      sessionStorage.setItem('__rt', data.refresh_token)
      router.push('/dashboard')
    } catch (e) {
      setError(e instanceof APIError ? e.message : 'Registration failed.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-10 w-full max-w-sm">
        <div className="flex items-center justify-center mb-8">
          <span className="text-xl font-bold text-gray-900">Humanite</span>
        </div>

        <h1 className="text-lg font-bold text-gray-900 mb-1 text-center">Create account</h1>
        <p className="text-xs text-gray-500 text-center mb-6">Join Humanite today</p>

        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200
                          rounded-xl text-sm text-red-600">
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
                       bg-gray-900 hover:bg-gray-800 disabled:opacity-40 transition-colors mt-2"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <Spinner className="w-3 h-3 border-white" />
                Creating account…
              </span>
            ) : 'Create account'}
          </button>
        </form>

        <p className="mt-5 text-xs text-center text-gray-400">
          Already have an account?{' '}
          <a href="/auth/login" className="text-gray-900 font-medium hover:opacity-70">
            Sign in
          </a>
        </p>
      </div>
    </div>
  )
}

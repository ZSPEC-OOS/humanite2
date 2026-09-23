'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useUserStore } from '@/stores/userStore'
import { authLogin, APIError } from '@/lib/api'
import { jwtDecode } from 'jwt-decode'
import { Spinner } from '@/components/ui/Spinner'
import { inputCls } from '@/components/ui/styles'

interface JWTClaims {
  sub: string
  tier: string
  region: string
  scopes: string[]
}

export default function LoginPage() {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState<string | null>(null)
  const [loading, setLoading]   = useState(false)
  const { setAuth } = useUserStore()
  const router = useRouter()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const data   = await authLogin(email, password)
      const claims = jwtDecode<JWTClaims>(data.access_token)
      setAuth(data.access_token, claims.sub, claims.tier, claims.region, claims.scopes)
      sessionStorage.setItem('__rt', data.refresh_token)
      router.push('/dashboard')
    } catch (e) {
      setError(e instanceof APIError ? e.message : 'Login failed.')
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

        <h1 className="text-lg font-bold text-gray-900 mb-1 text-center">Sign in</h1>
        <p className="text-xs text-gray-500 text-center mb-6">Welcome back</p>

        {error && (
          <div className="mb-4 p-3 bg-gray-50 border border-gray-200
                          rounded-xl text-sm font-medium text-gray-900">
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
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
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
                Signing in…
              </span>
            ) : 'Sign in'}
          </button>
        </form>

        <p className="mt-5 text-xs text-center text-gray-400">
          Don&apos;t have an account?{' '}
          <a href="/auth/register" className="text-gray-900 font-medium hover:opacity-70">
            Create one
          </a>
        </p>
      </div>
    </div>
  )
}

'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useUserStore } from '@/stores/userStore'
import { authLogin, APIError } from '@/lib/api'
import { jwtDecode } from 'jwt-decode'
import { Spinner } from '@/components/ui/Spinner'
import { darkInputCls } from '@/components/ui/styles'

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
    <div className="min-h-screen flex items-center justify-center bg-dark-base relative overflow-hidden">
      {/* Glow blobs */}
      <div className="absolute top-[-20%] left-[-10%] w-[60vw] h-[60vw] rounded-full
                      bg-brand-purple/10 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[50vw] h-[50vw] rounded-full
                      bg-brand-blue/8 blur-[100px] pointer-events-none" />

      <div className="card-dark p-10 w-full max-w-sm relative">
        {/* Logo */}
        <div className="flex items-center justify-center gap-2 mb-8">
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none" aria-hidden>
            <path d="M11 2L13.5 8.5L20 11L13.5 13.5L11 20L8.5 13.5L2 11L8.5 8.5L11 2Z"
              fill="url(#login-star)" />
            <defs>
              <linearGradient id="login-star" x1="2" y1="2" x2="20" y2="20">
                <stop stopColor="#a855f7" /><stop offset="1" stopColor="#ec4899" />
              </linearGradient>
            </defs>
          </svg>
          <span className="text-xl font-bold text-gradient">Humanite</span>
        </div>

        <h1 className="text-lg font-bold text-white mb-1 text-center">Sign in</h1>
        <p className="text-xs text-white/40 text-center mb-6">Welcome back</p>

        {error && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/25
                          rounded-xl text-sm text-red-400">
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
            className={`${darkInputCls} w-full`}
          />
          <input
            type="password"
            required
            placeholder="Password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            className={`${darkInputCls} w-full`}
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-xl text-sm font-semibold text-white
                       bg-gradient-to-r from-violet-600 via-purple-500 to-pink-500
                       hover:opacity-90 disabled:opacity-40 transition-opacity mt-2"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <Spinner className="w-3 h-3 border-white" />
                Signing in…
              </span>
            ) : 'Sign in'}
          </button>
        </form>

        <p className="mt-5 text-xs text-center text-white/30">
          Don&apos;t have an account?{' '}
          <a href="/auth/register" className="text-brand-violet hover:text-brand-violet/80">
            Create one
          </a>
        </p>
      </div>
    </div>
  )
}

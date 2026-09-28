import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, isAuthFailure, type AuthClaims } from './require-auth'

type AdminSuccess = { claims: AuthClaims }
type AdminFailure = NextResponse

// The server-side boundary every /api/admin/a2h/** route must call — the
// browser's isA2HAdmin flag (userStore.ts) and the /admin/a2h route guard
// are UX only; this is what actually enforces it, re-deriving the answer
// from the verified JWT's own a2h_admin claim rather than trusting anything
// the client sends. Per §23: "Benchmark tools are Admin-only; enforce
// permission checks server-side, not only in UI navigation."
export async function requireA2HAdmin(req: NextRequest): Promise<AdminSuccess | AdminFailure> {
  const auth = await requireAuth(req)
  if (isAuthFailure(auth)) return auth
  if (!auth.claims.a2h_admin) {
    return NextResponse.json(
      { error: { code: 'FORBIDDEN', message: 'A2H benchmark access requires the Gold admin account.' } },
      { status: 403 },
    )
  }
  return auth
}

import { create } from 'zustand'

interface UserState {
  // Stored in memory only — NEVER in localStorage or sessionStorage
  accessToken: string | null
  userId: string | null
  tier: string | null
  region: string | null
  scopes: string[]
  // Signed server-side into the access token (see auth-utils.ts's
  // issueAccessToken) from the account's own email + tier — never derived
  // client-side, since the client never holds the plaintext email.
  isA2HAdmin: boolean
  setAuth: (token: string, userId: string, tier: string, region: string, scopes: string[], isA2HAdmin: boolean) => void
  clearAuth: () => void
  isAuthenticated: () => boolean
  hasScope: (scope: string) => boolean
}

export const useUserStore = create<UserState>((set, get) => ({
  accessToken: null,
  userId: null,
  tier: null,
  region: null,
  scopes: [],
  isA2HAdmin: false,
  setAuth: (accessToken, userId, tier, region, scopes, isA2HAdmin) =>
    set({ accessToken, userId, tier, region, scopes, isA2HAdmin }),
  clearAuth: () =>
    set({ accessToken: null, userId: null, tier: null, region: null, scopes: [], isA2HAdmin: false }),
  isAuthenticated: () => !!get().accessToken,
  hasScope: (scope) => get().scopes.includes(scope),
}))

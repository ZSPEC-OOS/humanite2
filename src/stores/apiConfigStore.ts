import { create } from 'zustand'
import { useUserStore } from './userStore'

export interface ApiConfig {
  nickname: string
  modelId: string
  baseUrl: string
  apiKey: string
}

interface ApiConfigState {
  config: ApiConfig
  setConfig: (patch: Partial<ApiConfig>) => void
  clearConfig: () => void
  hasCustomConfig: () => boolean
  // Pulls the last config saved from any device (via R2) and adopts it
  // locally. Best-effort — silently no-ops if sync isn't configured/reachable
  // or if nothing has ever been synced.
  syncFromServer: () => Promise<void>
}

const STORAGE_KEY = 'humanite_api_config'
const DEFAULTS: ApiConfig = { nickname: '', modelId: '', baseUrl: '', apiKey: '' }

function load(): ApiConfig {
  if (typeof window === 'undefined') return DEFAULTS
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULTS
    return { ...DEFAULTS, ...JSON.parse(raw) }
  } catch {
    return DEFAULTS
  }
}

function save(config: ApiConfig) {
  if (typeof window === 'undefined') return
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(config)) } catch { /* ignore */ }
}

// Raw fetch rather than the shared apiFetch() helper (src/lib/api.ts) —
// that module imports this store, so importing it back here would be
// circular. Deliberately minimal: same auth header convention, no retries.
async function syncFetch(method: 'GET' | 'PUT', body?: ApiConfig) {
  const token = useUserStore.getState().accessToken
  const resp = await fetch('/api/v1/user/api-config', {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  if (!resp.ok) throw new Error(`Sync failed: HTTP ${resp.status}`)
  return resp.json()
}

export const useApiConfigStore = create<ApiConfigState>((set, get) => ({
  config: load(),

  setConfig: (patch) => {
    const next = { ...get().config, ...patch }
    save(next)
    set({ config: next })
    // Fire-and-forget — a device without R2 configured (or offline) still
    // gets the instant local save above; this just adds cross-device sync
    // on top when available.
    syncFetch('PUT', next).catch(() => {})
  },

  clearConfig: () => {
    if (typeof window !== 'undefined') localStorage.removeItem(STORAGE_KEY)
    set({ config: DEFAULTS })
    syncFetch('PUT', DEFAULTS).catch(() => {})
  },

  hasCustomConfig: () => {
    const { apiKey, modelId } = get().config
    return !!(apiKey.trim() && modelId.trim())
  },

  syncFromServer: async () => {
    try {
      const { config: synced } = await syncFetch('GET') as { config: ApiConfig | null }
      if (synced && (synced.apiKey.trim() || synced.modelId.trim())) {
        const next = { ...DEFAULTS, ...synced }
        save(next)
        set({ config: next })
      }
    } catch {
      // best-effort — keep whatever's local
    }
  },
}))
